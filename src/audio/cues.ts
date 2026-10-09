/**
 * Audio cues on plain `<audio>` elements, the way the POC did it (which stayed
 * in sync on a real iPhone where Web Audio did not).
 *
 * - Two media elements are created once, at app load. `unlock()`, called
 *   synchronously inside the Play tap, primes both with a muted play() + pause()
 *   so iOS lets them play later from timers. Media elements play through the
 *   iOS silent switch, so no audio-session handling is needed.
 * - The warning file is a 10-second countdown that must end exactly at zero.
 *   It is driven by the timer's clock only: a setTimeout starts it 10 s before
 *   the end, and `syncWarning()` (called from that timeout, every animation
 *   frame inside the last ten seconds, and on becoming visible) starts it at
 *   the offset matching the clock, or seeks it when it has drifted by more than
 *   0.3 s (at most one seek per second).
 * - Mute sets `muted` on both elements, so a toggle mid-countdown is immediate
 *   and the countdown stays in place underneath.
 *
 * Nothing in here throws: if audio is unavailable the app still works, silently.
 */

import { WARNING_MS } from '../core/timer';

export const CUE_URLS = {
  start: '/sounds/start.mp3',
  warning: '/sounds/warning-10s.mp3',
} as const;

type CueName = keyof typeof CUE_URLS;

/** A finish observed later than this after the timer's end was not seen live. */
const LIVE_FINISH_MS = 250;
/** The warning is re-seeked when it is further than this from where the clock says it should be (s). */
const DRIFT_TOLERANCE_S = 0.3;
/** At most one corrective seek (or retry of a refused play) per this many ms. */
const RETRY_INTERVAL_MS = 1_000;
/** Diagnostics kept for the `?debug` overlay. */
const RECENT_WARNINGS = 3;

/** The part of HTMLAudioElement the cues use (so tests can inject a fake). */
export type CueElement = Pick<
  HTMLMediaElement,
  'pause' | 'load' | 'currentTime' | 'paused' | 'ended' | 'muted' | 'readyState' | 'error' | 'preload'
> & {
  /** Old browsers return undefined instead of a promise. */
  play: () => Promise<void> | undefined;
  addEventListener: (type: string, cb: () => void) => void;
};

export interface CueElementInfo {
  readyState: number;
  paused: boolean;
  currentTime: number;
  errorCode: number | null;
}

/** A snapshot for the `?debug` overlay. */
export interface CuesDebugInfo {
  start: CueElementInfo | null;
  warning: CueElementInfo | null;
  /** Where the warning file should be now (s), or null outside the last ten seconds. */
  expectedOffset: number | null;
  /** warning.currentTime − expectedOffset (s), or null when there is nothing to compare. */
  drift: number | null;
  /** Timer time left until the armed end (ms), or null when nothing is armed. */
  remainingMs: number | null;
  /** The setTimeout that starts the warning is pending. */
  timerPending: boolean;
  /** The last few warnings logged (newest last). */
  recent: readonly string[];
}

export interface Cues {
  /** Prime the media elements. Call synchronously inside a user gesture. */
  unlock: () => void;
  /** One-shot start cue (skipped while muted). */
  playStart: () => void;
  /**
   * Arm the 10-second warning so that it ends at `endAt` (on the `now` clock,
   * i.e. the running timer's end). Replaces any earlier arm. If less than 10 s
   * is left, the cue starts immediately at the matching offset.
   */
  armWarning: (endAt: number) => void;
  /**
   * Idempotent sync, called every frame while the visible page sees the running
   * timer inside the last ten seconds: starts the warning at the offset
   * matching the clock if it is not playing, or seeks it if it drifted.
   */
  ensureWarning: (endAt: number) => void;
  /** Cancel the warning (pause / reset): pauses it; `rewind` also returns it to the start. */
  disarmWarning: (rewind?: boolean) => void;
  /**
   * The timer finished. If the finish is observed live, let the cue's last few
   * milliseconds ring out; otherwise (noticed late, e.g. back from the
   * background) pause it so it can never play late.
   */
  releaseWarning: () => void;
  setMuted: (muted: boolean) => void;
  /** State snapshot for the `?debug` overlay. */
  debugInfo: () => CuesDebugInfo;
  dispose: () => void;
}

export interface CuesOptions {
  muted?: boolean;
  /** The clock `armWarning` end times are on. Defaults to `performance.now()`. */
  now?: () => number;
  /** Creates the media element for a cue URL. Defaults to `new Audio(url)`; null when unavailable. */
  createElement?: (url: string) => CueElement | null;
  doc?: Document | null;
}

function defaultCreateElement(url: string): CueElement | null {
  if (typeof Audio === 'undefined') return null;
  return new Audio(url);
}

interface Cue {
  name: CueName;
  el: CueElement;
  /** The priming play() has not settled yet. */
  priming: boolean;
  /** A real play was requested while priming: the priming restore must not pause it. */
  claimed: boolean;
  /** A real play() promise has not settled yet. */
  playPending: boolean;
  /** `now()` of the last real play(). */
  playAt: number;
  /** `now()` of the last play() that was refused, or null. */
  refusedAt: number | null;
  /** Bumped by every play() and pause(), so a stale play() result is ignored. */
  gen: number;
}

export function createCues(opts: CuesOptions = {}): Cues {
  const now = opts.now ?? (() => performance.now());
  const makeElement = opts.createElement ?? defaultCreateElement;
  const doc = opts.doc === undefined ? (typeof document === 'undefined' ? null : document) : opts.doc;

  let muted = opts.muted ?? false;
  let primed = false;
  let disposed = false;

  /** Timer end (on the `now` clock) the warning is armed for, or null. */
  let endAt: number | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  /** `now()` of the last corrective seek. */
  let lastSeekAt = -Infinity;

  const warned = new Set<string>();
  const recent: string[] = [];
  /** Logs `msg` to the console once; every occurrence (with `detail`) goes to the debug overlay. */
  const warnOnce = (msg: string, err: unknown, detail = '') => {
    recent.push(detail ? `${msg} (${detail})` : msg);
    if (recent.length > RECENT_WARNINGS) recent.shift();
    if (warned.has(msg)) return;
    warned.add(msg);
    console.warn(`[cues] ${msg}`, ...(detail ? [detail] : []), err);
  };

  function makeCue(name: CueName): Cue | null {
    let el: CueElement | null;
    try {
      el = makeElement(CUE_URLS[name]);
    } catch (err) {
      warnOnce(`could not create the ${name} cue; it is unavailable`, err);
      return null;
    }
    if (!el) return null;
    try {
      el.preload = 'auto';
      // iOS: play inline, never fullscreen. Not in the audio element's typings; harmless elsewhere.
      (el as CueElement & { playsInline?: boolean }).playsInline = true;
      el.muted = muted;
      el.addEventListener('error', () => {
        warnOnce(`could not load the ${name} cue`, null, `error code ${String(el.error?.code ?? '?')}`);
      });
    } catch {
      // a partial element: keep going
    }
    return { name, el, priming: false, claimed: false, playPending: false, playAt: -Infinity, refusedAt: null, gen: 0 };
  }

  const start = makeCue('start');
  const warning = makeCue('warning');
  const cues = [start, warning].filter((c): c is Cue => c !== null);

  // ---- element helpers -------------------------------------------------------

  function seek(cue: Cue, t: number) {
    try {
      cue.el.currentTime = t;
    } catch (err) {
      warnOnce(`could not seek the ${cue.name} cue`, err);
    }
  }

  function pause(cue: Cue) {
    cue.claimed = false;
    // A pending play() is aborted by this pause; its outcome no longer matters.
    cue.gen++;
    cue.playPending = false;
    cue.refusedAt = null;
    try {
      cue.el.pause();
    } catch {
      // nothing to pause
    }
  }

  /** A real, audible-unless-muted play. */
  function play(cue: Cue) {
    if (cue.priming) cue.claimed = true;
    cue.el.muted = muted;
    cue.playPending = true;
    cue.playAt = now();
    const gen = ++cue.gen;
    let p: Promise<void> | undefined;
    try {
      p = cue.el.play();
    } catch (err) {
      cue.playPending = false;
      cue.refusedAt = now();
      warnOnce(`${cue.name} cue: play() threw`, err);
      return;
    }
    if (!p) {
      cue.playPending = false;
      return;
    }
    p.then(
      () => {
        if (gen !== cue.gen) return;
        cue.playPending = false;
        cue.refusedAt = null;
      },
      (err: unknown) => {
        if (gen !== cue.gen) return; // aborted by a later pause() or play()
        cue.playPending = false;
        cue.refusedAt = now();
        warnOnce(`${cue.name} cue: play() was refused`, err);
      },
    );
  }

  /** The POC's unlock: a muted play() that is undone as soon as it settles. */
  function prime(cue: Cue) {
    const { el } = cue;
    cue.priming = true;
    cue.claimed = false;
    const restore = () => {
      cue.priming = false;
      try {
        if (!cue.claimed) {
          el.pause();
          el.currentTime = 0;
        }
        el.muted = muted;
      } catch {
        // best effort
      }
      cue.claimed = false;
    };
    try {
      el.muted = true;
      const p = el.play();
      if (p) p.then(restore, restore);
      else restore();
    } catch (err) {
      warnOnce(`could not prime the ${cue.name} cue`, err);
      restore();
    }
  }

  // ---- unlock / start --------------------------------------------------------

  function unlock() {
    if (disposed) return;
    for (const cue of cues) {
      // Recover from a failed first fetch (or an element iOS never loaded).
      if (cue.el.error || cue.el.readyState === 0) {
        try {
          cue.el.load();
        } catch {
          // ignore
        }
      }
    }
    if (primed) return;
    primed = true;
    for (const cue of cues) prime(cue);
  }

  function playStart() {
    if (disposed || muted || !start) return;
    seek(start, 0);
    play(start);
  }

  // ---- warning ---------------------------------------------------------------

  function clearTimer() {
    if (timeout === null) return;
    clearTimeout(timeout);
    timeout = null;
  }

  /** Where the warning file should be now (s), or null outside the last ten seconds. */
  function expectedOffset(): number | null {
    if (endAt === null) return null;
    const left = endAt - now();
    if (left <= 0 || left > WARNING_MS) return null;
    return (WARNING_MS - left) / 1000;
  }

  /** A play() is in flight and recent (one that never settles stops counting after a second). */
  const starting = (cue: Cue) => cue.playPending && now() - cue.playAt < RETRY_INTERVAL_MS;

  /** The core: make the warning play at the offset matching the timer clock. Idempotent. */
  function syncWarning() {
    if (disposed || !warning) return;
    const offset = expectedOffset();
    if (offset === null) return;
    const { el } = warning;
    if (el.paused || el.ended) {
      // Don't hammer a play() that is in flight or was just refused.
      if (starting(warning)) return;
      if (warning.refusedAt !== null && now() - warning.refusedAt < RETRY_INTERVAL_MS) return;
      seek(warning, offset);
      play(warning);
      return;
    }
    // Still starting up: currentTime does not move yet, so drift means nothing.
    if (starting(warning)) return;
    const drift = el.currentTime - offset;
    if (Math.abs(drift) <= DRIFT_TOLERANCE_S) return;
    const t = now();
    if (t - lastSeekAt < RETRY_INTERVAL_MS) return;
    lastSeekAt = t;
    recent.push(`warning drift ${drift.toFixed(2)} s; seeked to ${offset.toFixed(2)}`);
    if (recent.length > RECENT_WARNINGS) recent.shift();
    seek(warning, offset);
  }

  function fire() {
    timeout = null;
    syncWarning();
  }

  function armWarning(at: number) {
    if (disposed) return;
    endAt = at;
    clearTimer();
    const lead = at - now() - WARNING_MS;
    if (lead > 0) {
      // Not in the window yet: make sure nothing is left playing from an earlier run.
      if (warning && !warning.el.paused) pause(warning);
      timeout = setTimeout(fire, lead);
    } else {
      fire();
    }
  }

  function ensureWarning(at: number) {
    if (disposed) return;
    endAt = at;
    syncWarning();
  }

  function disarmWarning(rewind = false) {
    endAt = null;
    clearTimer();
    if (!warning) return;
    pause(warning);
    if (rewind) seek(warning, 0);
  }

  function releaseWarning() {
    const at = endAt;
    endAt = null;
    clearTimer();
    if (!warning || at === null) return;
    // A finish seen live rings out (stopping would clip the last beep); a late one is silenced.
    if (now() - at > LIVE_FINISH_MS) pause(warning);
  }

  const onVisibility = () => {
    if (doc?.visibilityState === 'visible') syncWarning();
  };
  doc?.addEventListener('visibilitychange', onVisibility);

  // ---- debug -----------------------------------------------------------------

  function elementInfo(cue: Cue | null): CueElementInfo | null {
    if (!cue) return null;
    const { el } = cue;
    return {
      readyState: el.readyState,
      paused: el.paused,
      currentTime: Math.round(el.currentTime * 100) / 100,
      errorCode: el.error?.code ?? null,
    };
  }

  return {
    unlock,
    playStart,
    armWarning,
    ensureWarning,
    disarmWarning,
    releaseWarning,
    setMuted(m) {
      muted = m;
      for (const cue of cues) {
        // A priming element stays muted; its restore applies the current setting.
        if (cue.priming && !cue.claimed) continue;
        cue.el.muted = m;
      }
    },
    debugInfo() {
      const offset = expectedOffset();
      return {
        start: elementInfo(start),
        warning: elementInfo(warning),
        expectedOffset: offset,
        drift: offset === null || !warning ? null : warning.el.currentTime - offset,
        remainingMs: endAt === null ? null : endAt - now(),
        timerPending: timeout !== null,
        recent: [...recent],
      };
    },
    dispose() {
      disposed = true;
      endAt = null;
      clearTimer();
      for (const cue of cues) pause(cue);
      doc?.removeEventListener('visibilitychange', onVisibility);
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
