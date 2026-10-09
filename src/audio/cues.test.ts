import { describe, expect, it, vi } from 'vitest';
import {
  FakeAudioContext,
  FakeBuffer,
  cuesOptions,
  flush,
  okFetch,
  type Clock,
  type FakeContextOptions,
} from '../test/fakeAudio';
import { CUE_URLS, createCues, type CuesOptions } from './cues';

async function setup(opts: { ctx?: FakeContextOptions; cues?: Partial<CuesOptions>; t?: number } = {}) {
  const clock: Clock = { t: opts.t ?? 1_000 };
  const ctx = new FakeAudioContext(clock, opts.ctx);
  const cues = createCues(cuesOptions(ctx, clock, opts.cues));
  await flush(); // fetch + decode
  return { clock, ctx, cues };
}

/** First tap: unlock, then let resume() resolve. */
async function tap(cues: ReturnType<typeof createCues>) {
  cues.unlock();
  await flush(1);
}

const close = (a: number | undefined, b: number) => { expect(a).toBeCloseTo(b, 6); };

describe('first tap', () => {
  it('re-schedules at the true lead once the context actually starts running', async () => {
    const { clock, ctx, cues } = await setup();
    // The gesture handler: unlock, start cue, arm — all while the context is still suspended.
    cues.unlock();
    cues.playStart();
    cues.armWarning(clock.t + 60_000);
    expect(ctx.state).toBe('suspended');
    // Nothing is scheduled against the frozen clock of a suspended context.
    expect(ctx.warnings).toHaveLength(0);
    // resume() takes a while; the timer clock keeps going, the audio clock does not.
    clock.t += 200;
    await flush(1);
    expect(ctx.state).toBe('running');
    const w = ctx.lastWarning;
    close(w?.started?.when, 0 + 49.8);
    expect(ctx.liveWarnings).toHaveLength(1);
    expect(ctx.starts).toHaveLength(1);
  });
});

describe('warning scheduling', () => {
  it('starts the file 10 s before the end on the audio clock', async () => {
    const { clock, ctx, cues } = await setup();
    await tap(cues);
    ctx.advance(3_000);
    cues.armWarning(clock.t + 60_000);
    close(ctx.lastWarning?.started?.when, ctx.currentTime + 50);
    expect(ctx.lastWarning?.started?.offset).toBe(0);
  });

  it('starts immediately at the matching offset when less than 10 s is left', async () => {
    const { clock, ctx, cues } = await setup();
    await tap(cues);
    ctx.advance(1_000);
    cues.armWarning(clock.t + 7_500);
    close(ctx.lastWarning?.started?.when, ctx.currentTime);
    close(ctx.lastWarning?.started?.offset, 2.5);
  });

  it('compensates the reported output latency in both branches (with or without getOutputTimestamp)', async () => {
    const { clock, ctx, cues } = await setup({ ctx: { timestamp: false, outputLatency: 0.2 } });
    await tap(cues);
    ctx.advance(1_000);
    cues.armWarning(clock.t + 30_000);
    close(ctx.lastWarning?.started?.when, ctx.currentTime + 20 - 0.2);
    cues.armWarning(clock.t + 5_000);
    close(ctx.lastWarning?.started?.when, ctx.currentTime);
    close(ctx.lastWarning?.started?.offset, 5 + 0.2);
  });

  it('re-arming replaces the source; disarming stops it and suspends the idle context', async () => {
    const { clock, ctx, cues } = await setup();
    await tap(cues);
    cues.armWarning(clock.t + 30_000);
    cues.armWarning(clock.t + 25_000);
    const [first, second] = ctx.warnings;
    expect(first?.stopped).toBe(true);
    expect(second?.live).toBe(true);
    cues.disarmWarning();
    expect(second?.stopped).toBe(true);
    await flush(1);
    expect(ctx.state).toBe('suspended');
  });

  it('re-aligns after the OS suspended the context mid-run', async () => {
    const { clock, ctx, cues } = await setup();
    await tap(cues);
    cues.armWarning(clock.t + 60_000);
    ctx.interrupt();
    ctx.advance(20_000); // audio clock frozen
    void ctx.resume();
    await flush(1);
    const [first, second] = ctx.warnings;
    expect(first?.stopped).toBe(true);
    close(second?.started?.when, ctx.currentTime + 30);
  });

  it('arming before the warning is decoded schedules it when decoding resolves', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const offline = () =>
      ({
        decodeAudioData: async (data: ArrayBuffer) => {
          const url = new TextDecoder().decode(data);
          if (url === CUE_URLS.warning) await gate;
          return new FakeBuffer(url);
        },
      }) as unknown as BaseAudioContext;
    const { clock, ctx, cues } = await setup({ cues: { offlineContext: offline } });
    await tap(cues);
    cues.armWarning(clock.t + 40_000);
    expect(ctx.warnings).toHaveLength(0);
    ctx.advance(5_000);
    release();
    await flush();
    close(ctx.lastWarning?.started?.when, ctx.currentTime + 25);
  });
});

describe('clock mapping', () => {
  it('ignores a stale output timestamp after a suspend (WebKit)', async () => {
    const { clock, ctx, cues } = await setup();
    await tap(cues);
    ctx.advance(2_000);
    void ctx.suspend();
    await flush(1);
    ctx.advance(20_000); // frozen audio clock; the timestamp stays at the suspend
    void ctx.resume();
    await flush(1);
    cues.armWarning(clock.t + 40_000);
    close(ctx.lastWarning?.started?.when, ctx.currentTime + 30);
  });

  it('clamps an absurd reported latency to 0.5 s', async () => {
    const { clock, ctx, cues } = await setup({ ctx: { outputLatency: 7 } });
    await tap(cues);
    cues.armWarning(clock.t + 30_000);
    close(ctx.lastWarning?.started?.when, ctx.currentTime + 20 - 0.5);
  });
});

describe('ensureWarning (crossing self-heal)', () => {
  it('is a no-op when the schedule is within tolerance', async () => {
    const { clock, ctx, cues } = await setup();
    await tap(cues);
    const endAt = clock.t + 30_000;
    cues.armWarning(endAt);
    ctx.advance(20_100);
    ctx.skew(0.1); // 100 ms off: inside the 150 ms tolerance
    cues.ensureWarning(endAt);
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.liveWarnings).toHaveLength(1);
  });

  it('restarts a cue that is off by more than 150 ms at the offset matching the clock', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { clock, ctx, cues } = await setup();
    await tap(cues);
    const endAt = clock.t + 30_000;
    cues.armWarning(endAt);
    ctx.advance(21_000);
    ctx.skew(-0.5);
    cues.ensureWarning(endAt);
    const [first, second] = ctx.warnings;
    expect(first?.stopped).toBe(true);
    close(second?.started?.when, ctx.currentTime);
    close(second?.started?.offset, 1);
    expect(ctx.liveWarnings).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('out of sync'), expect.stringContaining('fileStart='), null);
    expect(cues.debugInfo().recent.at(-1)).toContain('expected=');
  });

  it('starts a missing cue, resuming a suspended context', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { clock, ctx, cues } = await setup();
    await tap(cues);
    const endAt = clock.t + 8_000;
    ctx.interrupt();
    cues.ensureWarning(endAt);
    expect(ctx.liveWarnings).toHaveLength(1);
    close(ctx.lastWarning?.started?.offset, 2);
    ctx.advance(300); // resume takes a while: the first source is now 300 ms late
    await flush(1);
    expect(ctx.state).toBe('running');
    expect(ctx.liveWarnings).toHaveLength(1);
    close(ctx.lastWarning?.started?.offset, 2.3);
  });
});

describe('offset guard', () => {
  it('never starts the file at an offset at or past its end', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 0.5 s latency with 20 ms left: the matching offset (10.48 s) is past the 10.06 s file.
    const { clock, ctx, cues } = await setup({ ctx: { outputLatency: 0.5 } });
    await tap(cues);
    cues.armWarning(clock.t + 20);
    cues.ensureWarning(clock.t + 20);
    expect(ctx.warnings).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('outside the file'), expect.stringContaining('duration='), null);
    for (const s of ctx.sources) expect(s.started?.offset ?? 0).toBeLessThan(10.06);
  });
});

describe('finish', () => {
  it('a late finish (context was suspended) stops the warning so it can never play afterwards', async () => {
    const { clock, ctx, cues } = await setup();
    await tap(cues);
    cues.armWarning(clock.t + 60_000);
    ctx.interrupt(); // phone locked mid-speech
    ctx.advance(70_000); // back after the end
    cues.releaseWarning(); // useTimer.sync() noticed the finish
    void ctx.resume();
    await flush(1);
    expect(ctx.liveWarnings).toHaveLength(0);
  });

  it('a late finish with a running context (finish observed > 250 ms late) also stops it', async () => {
    const { clock, ctx, cues } = await setup();
    await tap(cues);
    cues.armWarning(clock.t + 15_000);
    ctx.advance(16_000);
    cues.releaseWarning();
    expect(ctx.liveWarnings).toHaveLength(0);
  });

  it('a live finish lets the tail ring out, then suspends the context', async () => {
    const { clock, ctx, cues } = await setup();
    await tap(cues);
    cues.armWarning(clock.t + 12_000);
    ctx.advance(12_016); // one frame late
    cues.releaseWarning();
    const w = ctx.lastWarning;
    expect(w?.live).toBe(true);
    expect(ctx.state).toBe('running');
    w?.end();
    await flush(1);
    expect(ctx.state).toBe('suspended');
  });
});

describe('start cue', () => {
  it('plays, and the context is suspended after it ends when nothing else is pending', async () => {
    const { ctx, cues } = await setup();
    await tap(cues);
    cues.playStart();
    expect(ctx.starts[0]?.live).toBe(true);
    ctx.starts[0]?.end();
    await flush(1);
    expect(ctx.state).toBe('suspended');
  });

  it('a tap before the start cue is decoded still plays if it lands within 300 ms', async () => {
    const gates: (() => void)[] = [];
    const offline = () =>
      ({
        decodeAudioData: async (data: ArrayBuffer) => {
          await new Promise<void>((r) => gates.push(r));
          return new FakeBuffer(new TextDecoder().decode(data));
        },
      }) as unknown as BaseAudioContext;

    const a = await setup({ cues: { offlineContext: offline } });
    await tap(a.cues);
    a.cues.playStart();
    a.clock.t += 250;
    for (const g of gates.splice(0)) g();
    await flush();
    expect(a.ctx.starts).toHaveLength(1);

    const b = await setup({ cues: { offlineContext: offline } });
    await tap(b.cues);
    b.cues.playStart();
    b.clock.t += 400;
    for (const g of gates.splice(0)) g();
    await flush();
    expect(b.ctx.starts).toHaveLength(0);
  });
});

describe('context lifecycle', () => {
  it('does nothing before unlock, then arms correctly on unlock', async () => {
    const { clock, ctx, cues } = await setup();
    expect(() => {
      cues.playStart();
      cues.armWarning(clock.t + 30_000);
    }).not.toThrow();
    expect(ctx.sources).toHaveLength(0);
    clock.t += 1_000;
    await tap(cues);
    expect(ctx.starts).toHaveLength(0);
    expect(ctx.liveWarnings).toHaveLength(1);
    close(ctx.lastWarning?.started?.when, ctx.currentTime + 19);
  });

  it('mutes through the gain node, including a muted startup', async () => {
    const { ctx, cues } = await setup({ cues: { muted: true } });
    await tap(cues);
    expect(ctx.gainNode.gain.value).toBe(0);
    cues.setMuted(false);
    expect(ctx.gainNode.gain.value).toBe(1);
    cues.setMuted(true);
    expect(ctx.gainNode.gain.value).toBe(0);
  });

  it('resumes on visibility and on a tap only while a warning is armed; logs a refused resume once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }) as unknown as Document;
    const { clock, ctx, cues } = await setup({ cues: { doc } });
    await tap(cues);
    cues.armWarning(clock.t + 60_000);
    ctx.interrupt();
    ctx.refuseNext(2);
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.dispatchEvent(new Event('pointerdown'));
    await flush(1);
    expect(ctx.state).toBe('suspended');
    expect(warn).toHaveBeenCalledTimes(1);
    doc.dispatchEvent(new Event('pointerdown'));
    await flush(1);
    expect(ctx.state).toBe('running');

    cues.disarmWarning();
    await flush(1);
    const calls = ctx.resumeCalls;
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.dispatchEvent(new Event('pointerdown'));
    expect(ctx.resumeCalls).toBe(calls);
  });

  it('a start right after a pause is not lost to the pending suspend', async () => {
    const { clock, ctx, cues } = await setup();
    await tap(cues);
    cues.armWarning(clock.t + 60_000);
    cues.disarmWarning(); // pause → suspend() queued
    cues.unlock(); // resume tap before the suspend settled
    cues.armWarning(clock.t + 50_000);
    await flush(1);
    expect(ctx.state).toBe('running');
    expect(ctx.liveWarnings).toHaveLength(1);
  });
});

describe('loading', () => {
  it('without an OfflineAudioContext, decodes on the live context at unlock', async () => {
    const { clock, ctx, cues } = await setup({ cues: { offlineContext: null } });
    await tap(cues);
    await flush();
    cues.playStart();
    cues.armWarning(clock.t + 30_000);
    expect(ctx.starts).toHaveLength(1);
    expect(ctx.liveWarnings).toHaveLength(1);
  });

  it('falls back to the live context when offline decoding fails, and logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = () =>
      ({ decodeAudioData: (_d: ArrayBuffer, _ok: unknown, fail: (e: null) => void) => { fail(null); } }) as unknown as BaseAudioContext;
    const { ctx, cues } = await setup({ cues: { offlineContext: broken } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('offline decode'), expect.any(Error));
    await tap(cues);
    await flush();
    cues.playStart();
    expect(ctx.starts).toHaveLength(1);
  });

  it('rejects an HTML response (SPA fallback) with a clear message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const html = () => Promise.resolve(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }));
    await setup({ cues: { fetch: html } });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not load the start cue'),
      expect.objectContaining({ message: expect.stringContaining('returned HTML') as unknown }),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not load the warning cue'), expect.any(Error));
  });

  it('retries failed loads on unlock', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let online = false;
    const fetchFn = vi.fn((url: string) => (online ? okFetch(url) : Promise.reject(new TypeError('offline'))));
    const { ctx, cues } = await setup({ cues: { fetch: fetchFn } });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    online = true;
    await tap(cues);
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(4);
    cues.playStart();
    expect(ctx.starts).toHaveLength(1);
  });

  it('a 404 warns and leaves the cues silent without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { clock, ctx, cues } = await setup({ cues: { fetch: () => Promise.resolve(new Response('', { status: 404 })) } });
    expect(warn).toHaveBeenCalled();
    await tap(cues);
    expect(() => { cues.playStart(); cues.armWarning(clock.t + 1_000); }).not.toThrow();
    expect(ctx.starts).toHaveLength(0);
    expect(ctx.warnings).toHaveLength(0);
  });
});
