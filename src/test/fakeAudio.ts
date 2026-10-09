/**
 * A media-element fake for the cue tests: play() flips `paused` and returns a
 * promise (resolved by default; tests can hold or refuse it), currentTime only
 * moves when a test advances it, and every play/seek/load is recorded.
 */
import { CUE_URLS, type CueElement, type CuesOptions } from '../audio/cues';

type Listener = () => void;

export class FakeMediaElement implements CueElement {
  paused = true;
  ended = false;
  muted = false;
  preload: '' | 'none' | 'metadata' | 'auto' = '';
  playsInline = false;
  readyState = 4;
  error: MediaError | null = null;
  /** Offsets (s) at which play() was called while audible, i.e. not muted. */
  readonly audiblePlays: number[] = [];
  /** Every play() call: offset and whether the element was muted then. */
  readonly plays: { at: number; muted: boolean }[] = [];
  /** Every assignment to currentTime. */
  readonly seeks: number[] = [];
  loads = 0;
  /** How the next play() settles: 'resolve' (default), 'reject', or 'hold' (stays pending until `settle()`). */
  nextPlay: 'resolve' | 'reject' | 'hold' = 'resolve';
  private held: (() => void) | null = null;
  private time = 0;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly src: string) {}

  get currentTime() { return this.time; }
  set currentTime(t: number) {
    this.seeks.push(t);
    this.time = t;
    this.ended = false;
  }

  play(): Promise<void> {
    this.plays.push({ at: this.time, muted: this.muted });
    if (!this.muted) this.audiblePlays.push(this.time);
    const mode = this.nextPlay;
    this.nextPlay = 'resolve';
    if (mode === 'reject') return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    this.ended = false;
    if (mode === 'hold') return new Promise((resolve) => { this.held = resolve; });
    return Promise.resolve();
  }

  /** Resolve a held play(). */
  settle() {
    this.held?.();
    this.held = null;
  }

  pause() { this.paused = true; }

  load() {
    this.loads++;
    this.error = null;
    this.paused = true;
    this.time = 0;
  }

  addEventListener(type: string, cb: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }

  dispatch(type: string) {
    for (const cb of this.listeners.get(type) ?? []) cb();
  }

  /** Let `s` seconds of playback pass (no-op while paused). */
  advance(s: number) {
    if (!this.paused) this.time += s;
  }

  /** Playing and audible. */
  get audible() { return !this.paused && !this.muted; }
}

export interface FakeElements {
  start: FakeMediaElement;
  warning: FakeMediaElement;
}

/** Options for createCues backed by two fake elements; the clock is `Date.now()` (fake-timer friendly). */
export function cuesOptions(extra: Partial<CuesOptions> = {}): { opts: CuesOptions; els: FakeElements } {
  const els: FakeElements = {
    start: new FakeMediaElement(CUE_URLS.start),
    warning: new FakeMediaElement(CUE_URLS.warning),
  };
  const opts: CuesOptions = {
    now: () => Date.now(),
    createElement: (url) => (url === CUE_URLS.start ? els.start : els.warning),
    doc: null,
    ...extra,
  };
  return { opts, els };
}

/** Let pending promise chains settle. */
export async function flush(times = 5) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Let pending microtasks settle without touching (possibly fake) timers. */
export async function microtasks(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
