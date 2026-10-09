/**
 * Audio cues on Web Audio.
 *
 * - The two mp3 files are fetched and decoded once, at app load, without an
 *   AudioContext (decoding goes through an OfflineAudioContext, which needs no
 *   user gesture). If that is unavailable, decoding falls back to the live
 *   context once it exists.
 * - The live AudioContext is created lazily and synchronously inside the first
 *   user gesture (`unlock()`), which is what iOS Safari requires.
 * - The warning file is a 10-second countdown that must end exactly at zero, so
 *   it is scheduled against the timer's end time with sample accuracy instead
 *   of being fired from a JS timer.
 * - Mute is a GainNode at 0/1, so scheduled cues stay in place while muted.
 *
 * Nothing in here throws: if audio is unavailable the app still works, silently.
 */

import { WARNING_MS } from '../core/timer';

export const CUE_URLS = {
  start: '/sounds/start.mp3',
  warning: '/sounds/warning-10s.mp3',
} as const;

type CueName = keyof typeof CUE_URLS;

export interface Cues {
  /** Create/resume the AudioContext. Call synchronously inside a user gesture. */
  unlock: () => void;
  /** One-shot start cue. */
  playStart: () => void;
  /**
   * Schedule the 10-second warning so that it ends at `endAt` (a value on the
   * same clock as `now`, i.e. the running timer's end). Replaces any earlier
   * schedule. If less than 10 s is left, the cue starts immediately at the
   * matching offset so it stays in sync with the clock.
   */
  armWarning: (endAt: number) => void;
  /** Cancel the warning (pause / reset). Stops it if already playing. */
  disarmWarning: () => void;
  /**
   * Forget the warning without stopping it (the timer finished: the cue ends on
   * its own at the same moment, so stopping it would only clip its tail).
   */
  releaseWarning: () => void;
  setMuted: (muted: boolean) => void;
  dispose: () => void;
}

export interface CuesOptions {
  muted?: boolean;
  /** The clock `armWarning` end times are on. Defaults to `performance.now()`. */
  now?: () => number;
  /** Injection points for tests. */
  audioContext?: () => AudioContext;
  offlineContext?: (() => BaseAudioContext) | null;
  fetch?: (url: string) => Promise<Response>;
  doc?: Document | null;
}

type WindowWithWebkitAudio = typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
};

function defaultAudioContext(): AudioContext {
  const w = globalThis as WindowWithWebkitAudio;
  const Ctor = globalThis.AudioContext as typeof AudioContext | undefined ?? w.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio is not supported');
  return new Ctor();
}

function defaultOfflineContext(): (() => BaseAudioContext) | null {
  const w = globalThis as WindowWithWebkitAudio;
  const Ctor = globalThis.OfflineAudioContext as typeof OfflineAudioContext | undefined ?? w.webkitOfflineAudioContext;
  return Ctor ? () => new Ctor(1, 1, 44_100) : null;
}

/**
 * iOS routes Web Audio through the "ambient" session by default, which the
 * hardware silent switch mutes (unlike the <audio> elements the POC used).
 * Safari 16.4+ lets a page opt into the "playback" session instead, so the
 * cues are heard like any media. Elsewhere this is a no-op.
 */
function preferMediaAudioSession(): void {
  const nav = globalThis.navigator as (Navigator & { audioSession?: { type: string } }) | undefined;
  try {
    if (nav?.audioSession) nav.audioSession.type = 'playback';
  } catch {
    // not supported
  }
}

/** decodeAudioData with a callback fallback for old Safari, which has no promise form. */
function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    p?.then(resolve, reject);
  });
}

export function createCues(opts: CuesOptions = {}): Cues {
  const now = opts.now ?? (() => performance.now());
  const makeContext = opts.audioContext ?? defaultAudioContext;
  const makeOffline = opts.offlineContext === undefined ? defaultOfflineContext() : opts.offlineContext;
  const doFetch = opts.fetch ?? ((url: string) => fetch(url));
  const doc = opts.doc === undefined ? (typeof document === 'undefined' ? null : document) : opts.doc;

  let muted = opts.muted ?? false;
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let disposed = false;
  let warned = false;

  /** Fetched but not yet decoded (only when there is no OfflineAudioContext). */
  const raw = new Map<CueName, ArrayBuffer>();
  const buffers: Partial<Record<CueName, AudioBuffer>> = {};

  /** Timer end (on the `now` clock) the warning is armed for, or null. */
  let warningEndAt: number | null = null;
  let warningSource: AudioBufferSourceNode | null = null;

  const warnOnce = (msg: string, err: unknown) => {
    if (warned) return;
    warned = true;
    console.warn(`[cues] ${msg}; audio cues are unavailable.`, err);
  };

  const setBuffer = (name: CueName, buf: AudioBuffer) => {
    buffers[name] = buf;
    if (name === 'warning') scheduleWarning();
  };

  // ---- loading ---------------------------------------------------------------

  async function loadOne(name: CueName): Promise<void> {
    const res = await doFetch(CUE_URLS[name]);
    if (!res.ok) throw new Error(`HTTP ${String(res.status)} for ${CUE_URLS[name]}`);
    const data = await res.arrayBuffer();
    if (disposed) return;
    if (makeOffline) {
      try {
        // decodeAudioData detaches its input, so hand it a copy and keep `data` for the fallback.
        setBuffer(name, await decode(makeOffline(), data.slice(0)));
        return;
      } catch {
        // fall back to decoding on the live context
      }
    }
    if (ctx) {
      setBuffer(name, await decode(ctx, data));
    } else {
      raw.set(name, data); // decoded in unlock()
    }
  }

  for (const name of Object.keys(CUE_URLS) as CueName[]) {
    loadOne(name).catch((err: unknown) => {
      warnOnce(`could not load ${name} cue`, err);
    });
  }

  // ---- context ---------------------------------------------------------------

  function resumeIfNeeded() {
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
      ctx.resume().catch(() => undefined);
    }
  }

  function unlock() {
    if (disposed) return;
    if (!ctx) {
      preferMediaAudioSession();
      try {
        ctx = makeContext();
        gain = ctx.createGain();
        gain.gain.value = muted ? 0 : 1;
        gain.connect(ctx.destination);
        // The context's clock only advances while running; whenever it (re)starts
        // running, re-align the warning with the timer's clock.
        ctx.addEventListener('statechange', () => {
          if (ctx?.state === 'running') scheduleWarning();
        });
      } catch (err) {
        warnOnce('could not create an AudioContext', err);
        ctx = null;
        gain = null;
        return;
      }
      const liveCtx = ctx;
      for (const [name, data] of raw) {
        decode(liveCtx, data).then(
          (buf) => { setBuffer(name, buf); },
          (err: unknown) => { warnOnce(`could not decode ${name} cue`, err); },
        );
      }
      raw.clear();
    }
    resumeIfNeeded();
  }

  const onVisibility = () => {
    if (doc?.visibilityState === 'visible') resumeIfNeeded();
  };
  doc?.addEventListener('visibilitychange', onVisibility);

  // ---- playback --------------------------------------------------------------

  function makeSource(buf: AudioBuffer): AudioBufferSourceNode | null {
    if (!ctx || !gain) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    return src;
  }

  function stopWarningSource() {
    const src = warningSource;
    warningSource = null;
    if (!src) return;
    try {
      src.stop();
    } catch {
      // never started, or already stopped
    }
    src.disconnect();
  }

  function scheduleWarning() {
    stopWarningSource();
    const buf = buffers.warning;
    if (warningEndAt === null || !buf || !ctx) return;
    const leftMs = warningEndAt - now();
    if (leftMs <= 0) return;
    const src = makeSource(buf);
    if (!src) return;
    try {
      if (leftMs > WARNING_MS) {
        src.start(ctx.currentTime + (leftMs - WARNING_MS) / 1000);
      } else {
        const offset = (WARNING_MS - leftMs) / 1000;
        if (offset >= buf.duration) return;
        src.start(0, offset);
      }
    } catch (err) {
      warnOnce('could not schedule the warning cue', err);
      return;
    }
    src.addEventListener('ended', () => {
      if (warningSource === src) warningSource = null;
      src.disconnect();
    });
    warningSource = src;
  }

  function playStart() {
    const buf = buffers.start;
    if (!buf) return;
    const src = makeSource(buf);
    if (!src) return;
    src.addEventListener('ended', () => { src.disconnect(); });
    try {
      src.start();
    } catch (err) {
      warnOnce('could not play the start cue', err);
    }
  }

  return {
    unlock,
    playStart,
    armWarning(endAt) {
      warningEndAt = endAt;
      scheduleWarning();
    },
    disarmWarning() {
      warningEndAt = null;
      stopWarningSource();
    },
    releaseWarning() {
      warningEndAt = null;
      warningSource = null;
    },
    setMuted(m) {
      muted = m;
      if (gain && ctx) gain.gain.setValueAtTime(m ? 0 : 1, ctx.currentTime);
    },
    dispose() {
      disposed = true;
      warningEndAt = null;
      stopWarningSource();
      doc?.removeEventListener('visibilitychange', onVisibility);
      ctx?.close().catch(() => undefined);
      ctx = null;
      gain = null;
    },
  };
}

// ---- mute persistence ----------------------------------------------------------

const MUTE_KEY = 'mafia-timer:muted';

export function readStoredMute(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function storeMute(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // storage unavailable (private mode, blocked): mute just won't persist
  }
}
