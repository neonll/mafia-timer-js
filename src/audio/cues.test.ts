import { describe, expect, it, vi } from 'vitest';
import { CUE_URLS, createCues } from './cues';

/** Minimal Web Audio fake: records how sources are started/stopped. */
class FakeSource {
  buffer: { name: string; duration: number } | null = null;
  started: { when: number; offset: number | undefined } | null = null;
  stopped = false;
  connect() { /* noop */ }
  disconnect() { /* noop */ }
  addEventListener() { /* noop */ }
  start(when = 0, offset?: number) { this.started = { when, offset }; }
  stop() { this.stopped = true; }
}

class FakeContext {
  currentTime = 100; // arbitrary non-zero audio clock
  state: AudioContextState = 'running';
  destination = {};
  sources: FakeSource[] = [];
  gain = { gain: { value: 1, setValueAtTime: vi.fn((v: number) => { this.gain.gain.value = v; }) }, connect() { /* noop */ } };
  listeners: (() => void)[] = [];
  createGain() { return this.gain; }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
  addEventListener(_: string, cb: () => void) { this.listeners.push(cb); }
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
}

const offline = () =>
  ({
    decodeAudioData: (data: ArrayBuffer) =>
      Promise.resolve({ name: new TextDecoder().decode(data), duration: 10.06 }),
  }) as unknown as BaseAudioContext;

const okFetch = (url: string) => Promise.resolve(new Response(url));

async function setup(clock: { t: number }) {
  const ctx = new FakeContext();
  const cues = createCues({
    now: () => clock.t,
    audioContext: () => ctx as unknown as AudioContext,
    offlineContext: offline,
    fetch: okFetch,
    doc: null,
  });
  await vi.waitFor(() => { cues.unlock(); cues.playStart(); expect(ctx.sources.length).toBeGreaterThan(0); });
  ctx.sources.length = 0;
  return { ctx, cues };
}

const warnings = (ctx: FakeContext) => ctx.sources.filter((s) => s.buffer?.name === CUE_URLS.warning);

describe('cues: warning scheduling', () => {
  it('schedules the warning to start 10 s before the end', async () => {
    const clock = { t: 5_000 };
    const { ctx, cues } = await setup(clock);
    cues.armWarning(clock.t + 60_000);
    const [w] = warnings(ctx);
    expect(w?.started).toEqual({ when: 100 + 50, offset: undefined });
  });

  it('starts immediately at the matching offset when less than 10 s is left', async () => {
    const clock = { t: 0 };
    const { ctx, cues } = await setup(clock);
    cues.armWarning(clock.t + 7_500);
    const [w] = warnings(ctx);
    expect(w?.started).toEqual({ when: 0, offset: 2.5 });
  });

  it('stops the scheduled source when disarmed, and re-arming replaces it', async () => {
    const clock = { t: 0 };
    const { ctx, cues } = await setup(clock);
    cues.armWarning(30_000);
    cues.armWarning(25_000);
    const [first, second] = warnings(ctx);
    expect(first?.stopped).toBe(true);
    expect(second?.stopped).toBe(false);
    cues.disarmWarning();
    expect(second?.stopped).toBe(true);
  });

  it('release forgets the source without stopping it (finish lets the tail ring out)', async () => {
    const clock = { t: 0 };
    const { ctx, cues } = await setup(clock);
    cues.armWarning(5_000);
    cues.releaseWarning();
    expect(warnings(ctx)[0]?.stopped).toBe(false);
  });

  it('re-aligns the warning when the context starts running again', async () => {
    const clock = { t: 0 };
    const { ctx, cues } = await setup(clock);
    cues.armWarning(60_000);
    // The audio clock was frozen while suspended; the timer clock was not.
    clock.t = 20_000;
    for (const l of ctx.listeners) l();
    const [first, second] = warnings(ctx);
    expect(first?.stopped).toBe(true);
    expect(second?.started).toEqual({ when: 100 + 30, offset: undefined });
  });

  it('mutes through the gain node', async () => {
    const { ctx, cues } = await setup({ t: 0 });
    cues.setMuted(true);
    expect(ctx.gain.gain.value).toBe(0);
    cues.setMuted(false);
    expect(ctx.gain.gain.value).toBe(1);
  });
});

describe('cues: failure modes', () => {
  it('warns once and stays silent when loading fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ctx = new FakeContext();
    const cues = createCues({
      audioContext: () => ctx as unknown as AudioContext,
      offlineContext: offline,
      fetch: () => Promise.resolve(new Response('', { status: 404 })),
      doc: null,
    });
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledTimes(1); });
    cues.unlock();
    expect(() => { cues.playStart(); cues.armWarning(1_000); }).not.toThrow();
    expect(ctx.sources).toHaveLength(0);
    warn.mockRestore();
  });

  it('does nothing before unlock', async () => {
    const ctx = new FakeContext();
    const make = vi.fn(() => ctx as unknown as AudioContext);
    const cues = createCues({ audioContext: make, offlineContext: offline, fetch: okFetch, doc: null });
    await Promise.resolve();
    cues.playStart();
    cues.armWarning(1_000);
    expect(make).not.toHaveBeenCalled();
  });
});
