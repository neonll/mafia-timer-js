/**
 * Audio cues on Web Audio.
 *
 * - The two mp3 files are fetched and decoded once, at app load, without an
 *   AudioContext (decoding goes through an OfflineAudioContext, which needs no
 *   user gesture). If that is unavailable or fails, decoding falls back to the
 *   live context once it exists. `unlock()` retries cues that failed to load.
 * - The live AudioContext is created lazily and synchronously inside the first
 *   user gesture (`unlock()`), which is what iOS Safari requires. It is
 *   suspended again whenever nothing is playing or scheduled, so the page does
 *   not hold the media audio session while the timer is idle or paused.
 * - The warning file is a 10-second countdown that must end exactly at zero, so
 *   it is scheduled against the timer's end time on the audio clock (corrected
 *   for output latency) instead of being fired from a JS timer, and re-aligned
 *   whenever the context starts running again.
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
const CUE_NAMES = Object.keys(CUE_URLS) as CueName[];

/** A start cue requested before it was decoded still plays if it lands within this window. */
const START_PENDING_MS = 300;
/** A finish observed later than this after the timer's end was not seen live. */
const LIVE_FINISH_MS = 250;

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
   * The timer finished. If the finish is being observed live and the cue is
   * audibly playing, let its last few milliseconds ring out (stopping would
   * clip the final beep); otherwise (e.g. the finish is only noticed when the
   * page comes back from the background) stop it so it can never play late.
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
  return Ctor ? () => new Ctor(1, 1, 48_000) : null;
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
    // Old Safari calls the error callback with null.
    const fail = (err: unknown) => {
      reject(err instanceof Error ? err : new Error('decodeAudioData failed', { cause: err }));
    };
    const p = ctx.decodeAudioData(data, resolve, fail) as Promise<AudioBuffer> | undefined;
    p?.then(resolve, fail);
  });
}

interface ScheduledWarning {
  src: AudioBufferSourceNode;
  /** Audio-clock time at which the file's first sample is (or would have been) played. */
  fileStart: number;
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
  /** A suspend() is queued and no resume() has been requested since. */
  let suspendRequested = false;

  const buffers = new Map<CueName, AudioBuffer>();
  /** Fetched but not yet decoded (waiting for the live context). */
  const raw = new Map<CueName, ArrayBuffer>();
  /** Fetch or decode in flight. */
  const loading = new Set<CueName>();

  /** Timer end (on the `now` clock) the warning is armed for, or null. */
  let warningEndAt: number | null = null;
  let warning: ScheduledWarning | null = null;
  /** Start cues currently playing (including a warning tail left to ring out). */
  let playing = 0;
  /** `now()` at which a start cue was requested before its buffer was ready. */
  let startPendingAt: number | null = null;

  const warned = new Set<string>();
  const warnOnce = (msg: string, err: unknown) => {
    if (warned.has(msg)) return;
    warned.add(msg);
    console.warn(`[cues] ${msg}`, err);
  };

  // ---- loading ---------------------------------------------------------------

  const setBuffer = (name: CueName, buf: AudioBuffer) => {
    buffers.set(name, buf);
    if (name === 'warning') {
      scheduleWarning();
    } else if (startPendingAt !== null) {
      const late = now() - startPendingAt;
      startPendingAt = null;
      if (late <= START_PENDING_MS) playStart();
    }
  };

  async function decodeLive(name: CueName, data: ArrayBuffer, live: AudioContext): Promise<void> {
    try {
      setBuffer(name, await decode(live, data));
    } catch (err) {
      warnOnce(`could not decode the ${name} cue; it is unavailable`, err);
    }
  }

  async function loadOne(name: CueName): Promise<void> {
    loading.add(name);
    try {
      const url = CUE_URLS[name];
      const res = await doFetch(url);
      if (!res.ok) throw new Error(`HTTP ${String(res.status)} for ${url}`);
      // A missing file comes back as the SPA's index.html with status 200.
      if (res.headers.get('content-type')?.includes('text/html')) {
        throw new Error(`${url} returned HTML (missing file behind the SPA fallback?)`);
      }
      const data = await res.arrayBuffer();
      if (disposed) return;
      if (makeOffline) {
        try {
          // decodeAudioData detaches its input, so hand it a copy and keep `data` for the fallback.
          setBuffer(name, await decode(makeOffline(), data.slice(0)));
          return;
        } catch (err) {
          warnOnce(`offline decode of the ${name} cue failed; retrying on the live context`, err);
        }
      }
      if (ctx) await decodeLive(name, data, ctx);
      else raw.set(name, data); // decoded in unlock()
    } catch (err) {
      warnOnce(`could not load the ${name} cue; it is unavailable`, err);
    } finally {
      loading.delete(name);
    }
  }

  for (const name of CUE_NAMES) void loadOne(name);

  // ---- context ---------------------------------------------------------------

  const isRunning = () => ctx?.state === 'running';

  function resumeIfNeeded() {
    if (!ctx || ctx.state === 'closed') return;
    // state still reads 'running' while a suspend() is pending, so check the flag too.
    if (ctx.state === 'running' && !suspendRequested) return;
    suspendRequested = false;
    ctx.resume().catch((err: unknown) => {
      warnOnce('AudioContext.resume() was refused; will retry on the next tap', err);
    });
  }

  /** Release the audio session when nothing is playing or scheduled. */
  function suspendIfIdle() {
    if (!ctx || !isRunning() || suspendRequested) return;
    if (warningEndAt !== null || warning || playing > 0 || startPendingAt !== null) return;
    suspendRequested = true;
    ctx.suspend().catch(() => undefined);
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
          if (isRunning() && warningEndAt !== null) scheduleWarning();
        });
      } catch (err) {
        warnOnce('could not create an AudioContext; audio cues are unavailable', err);
        ctx = null;
        gain = null;
        return;
      }
    }
    const live = ctx;
    for (const [name, data] of raw) {
      raw.delete(name);
      loading.add(name);
      void decodeLive(name, data, live).finally(() => loading.delete(name));
    }
    // Retry anything that failed to load (e.g. offline at first launch).
    for (const name of CUE_NAMES) {
      if (!buffers.has(name) && !loading.has(name)) void loadOne(name);
    }
    resumeIfNeeded();
  }

  const onVisibility = () => {
    if (doc?.visibilityState === 'visible' && warningEndAt !== null) resumeIfNeeded();
  };
  // iOS may refuse resume() outside a gesture; any tap while a warning is armed retries.
  const onPointerDown = () => {
    if (warningEndAt !== null) resumeIfNeeded();
  };
  doc?.addEventListener('visibilitychange', onVisibility);
  doc?.addEventListener('pointerdown', onPointerDown, { capture: true });

  // ---- clocks ----------------------------------------------------------------

  /**
   * Audio-clock time whose samples are heard at timer-clock time `t`. Uses the
   * output timestamp (which includes output latency, e.g. Bluetooth) when the
   * browser provides one, otherwise subtracts the reported latency.
   */
  function audioTimeFor(live: AudioContext, t: number): number {
    const ts = typeof live.getOutputTimestamp === 'function' ? live.getOutputTimestamp() : null;
    if (ts?.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      return ts.contextTime + (t - ts.performanceTime) / 1000;
    }
    // Typed as numbers, but absent in some browsers (outputLatency in older Safari).
    const lat = live as { outputLatency?: number; baseLatency?: number };
    const latency = lat.outputLatency ?? lat.baseLatency ?? 0;
    return live.currentTime + (t - now()) / 1000 - latency;
  }

  // ---- playback --------------------------------------------------------------

  function makeSource(buf: AudioBuffer): AudioBufferSourceNode | null {
    if (!ctx || !gain) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    return src;
  }

  function stopWarning() {
    const w = warning;
    warning = null;
    if (!w) return;
    try {
      w.src.stop();
    } catch {
      // never started, or already stopped
    }
    w.src.disconnect();
  }

  function scheduleWarning() {
    stopWarning();
    const buf = buffers.get('warning');
    if (warningEndAt === null || !buf || !ctx) return;
    if (warningEndAt - now() <= 0) return;
    const src = makeSource(buf);
    if (!src) return;
    const fileStart = audioTimeFor(ctx, warningEndAt - WARNING_MS);
    const t = ctx.currentTime;
    try {
      if (fileStart >= t) src.start(fileStart);
      else src.start(t, t - fileStart);
    } catch (err) {
      src.disconnect();
      warnOnce('could not schedule the warning cue', err);
      return;
    }
    const scheduled: ScheduledWarning = { src, fileStart };
    src.addEventListener('ended', () => {
      src.disconnect();
      if (warning === scheduled) warning = null;
      suspendIfIdle();
    });
    warning = scheduled;
  }

  function playStart() {
    if (!ctx) return;
    const buf = buffers.get('start');
    if (!buf) {
      startPendingAt = now();
      return;
    }
    const src = makeSource(buf);
    if (!src) return;
    try {
      src.start();
    } catch (err) {
      src.disconnect();
      warnOnce('could not play the start cue', err);
      return;
    }
    playing++;
    src.addEventListener('ended', () => {
      src.disconnect();
      playing--;
      suspendIfIdle();
    });
  }

  function releaseWarning() {
    const endAt = warningEndAt;
    const w = warning;
    warningEndAt = null;
    const live =
      w !== null &&
      endAt !== null &&
      ctx !== null &&
      isRunning() &&
      now() - endAt < LIVE_FINISH_MS &&
      ctx.currentTime >= w.fileStart;
    if (!live) {
      stopWarning();
      suspendIfIdle();
      return;
    }
    // Let the tail ring out; its 'ended' handler cleans up and suspends.
    warning = null;
    playing++;
    w.src.addEventListener('ended', () => {
      playing--;
      suspendIfIdle();
    });
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
      stopWarning();
      suspendIfIdle();
    },
    releaseWarning,
    setMuted(m) {
      muted = m;
      if (gain && ctx) gain.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.015);
    },
    dispose() {
      disposed = true;
      warningEndAt = null;
      stopWarning();
      doc?.removeEventListener('visibilitychange', onVisibility);
      doc?.removeEventListener('pointerdown', onPointerDown, { capture: true });
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
