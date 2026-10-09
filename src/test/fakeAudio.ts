/**
 * A deliberately strict Web Audio fake for the cue tests: the audio clock only
 * advances while the context is running, resume()/suspend() change state
 * asynchronously and fire `statechange`, and sources keep their listeners so
 * tests can fire `ended`.
 */
import { CUE_URLS } from '../audio/cues';
import type { CuesOptions } from '../audio/cues';

type Listener = () => void;

export interface Clock {
  t: number;
}

export class FakeBuffer {
  constructor(
    readonly url: string,
    readonly duration = 10.06,
  ) {}
}

export class FakeSource {
  buffer: FakeBuffer | null = null;
  started: { when: number; offset: number } | null = null;
  stopped = false;
  connected = false;
  private readonly listeners: Listener[] = [];

  connect() { this.connected = true; }
  disconnect() { this.connected = false; }
  addEventListener(type: string, cb: Listener) {
    if (type === 'ended') this.listeners.push(cb);
  }
  start(when = 0, offset = 0) {
    if (this.started) throw new Error('InvalidStateError: start() called twice');
    this.started = { when, offset };
  }
  stop() {
    if (!this.started) throw new Error('InvalidStateError: stop() before start()');
    this.stopped = true;
  }
  /** Fire `ended`, as the engine does when playback finishes or after stop(). */
  end() { for (const cb of this.listeners) cb(); }
  get isWarning() { return this.buffer?.url === CUE_URLS.warning; }
  get isStart() { return this.buffer?.url === CUE_URLS.start; }
  /** Started and not stopped: it will be (or is being) heard. */
  get live() { return this.started !== null && !this.stopped; }
}

export interface FakeContextOptions {
  /** Provide getOutputTimestamp() (default true). */
  timestamp?: boolean;
  outputLatency?: number;
  /** Number of resume() calls to reject before succeeding. */
  refuseResume?: number;
}

export class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  outputLatency: number | undefined;
  readonly destination = {};
  readonly sources: FakeSource[] = [];
  readonly gainNode = {
    gain: {
      value: 1,
      setTargetAtTime(v: number) { this.value = v; },
    },
    connect() { /* noop */ },
  };
  resumeCalls = 0;
  suspendCalls = 0;
  /** Set once the context has run at least once (browsers report a zero timestamp before). */
  private hasRun = false;
  private readonly listeners: Listener[] = [];
  private refuse: number;
  getOutputTimestamp?: () => AudioTimestamp;

  constructor(
    private readonly clock: Clock,
    opts: FakeContextOptions = {},
  ) {
    this.outputLatency = opts.outputLatency;
    this.refuse = opts.refuseResume ?? 0;
    if (opts.timestamp ?? true) {
      this.getOutputTimestamp = () =>
        this.hasRun ? { contextTime: this.currentTime, performanceTime: this.clock.t } : { contextTime: 0, performanceTime: 0 };
    }
  }

  createGain() { return this.gainNode; }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  addEventListener(type: string, cb: Listener) {
    if (type === 'statechange') this.listeners.push(cb);
  }
  decodeAudioData(data: ArrayBuffer): Promise<FakeBuffer> {
    return Promise.resolve(new FakeBuffer(new TextDecoder().decode(data)));
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.refuse > 0) {
      this.refuse--;
      return Promise.reject(new Error('NotAllowedError'));
    }
    return Promise.resolve().then(() => { this.setState('running'); });
  }
  suspend(): Promise<void> {
    this.suspendCalls++;
    return Promise.resolve().then(() => { this.setState('suspended'); });
  }
  close(): Promise<void> {
    this.setState('closed');
    return Promise.resolve();
  }
  /** Make the next `n` resume() calls reject (as iOS does outside a gesture). */
  refuseNext(n: number) { this.refuse = n; }
  /** The OS takes the audio away (iOS: lock screen, app switch, call). */
  interrupt() { this.setState('suspended'); }
  /** Let `ms` pass on the timer clock; the audio clock follows only while running. */
  advance(ms: number) {
    this.clock.t += ms;
    if (this.state === 'running') this.currentTime += ms / 1000;
  }

  get warnings() { return this.sources.filter((s) => s.isWarning); }
  get starts() { return this.sources.filter((s) => s.isStart); }
  get liveWarnings() { return this.warnings.filter((s) => s.live); }
  get lastWarning() { return this.warnings.at(-1); }

  private setState(s: AudioContextState) {
    if (this.state === s) return;
    this.state = s;
    if (s === 'running') this.hasRun = true;
    for (const cb of this.listeners) cb();
  }
}

/** An OfflineAudioContext stand-in whose decode returns a FakeBuffer named after the URL. */
export const fakeOffline = () =>
  ({
    decodeAudioData: (data: ArrayBuffer) => Promise.resolve(new FakeBuffer(new TextDecoder().decode(data))),
  }) as unknown as BaseAudioContext;

/** fetch() stand-in: the body is the URL itself, so decoded buffers know which cue they are. */
export const okFetch = (url: string) => Promise.resolve(new Response(url, { headers: { 'content-type': 'audio/mpeg' } }));

/** Let pending promise chains (fetch → arrayBuffer → decode) settle. */
export async function flush(times = 5) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

export function cuesOptions(ctx: FakeAudioContext, clock: Clock, extra: Partial<CuesOptions> = {}): CuesOptions {
  return {
    now: () => clock.t,
    audioContext: () => ctx as unknown as AudioContext,
    offlineContext: fakeOffline,
    fetch: okFetch,
    doc: null,
    ...extra,
  };
}
