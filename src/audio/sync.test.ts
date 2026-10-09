// @vitest-environment jsdom
// Integration: the real cue engine driven by the real useTimer, against the fake audio context.
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimer } from '../hooks/useTimer';
import { FakeAudioContext, cuesOptions, flush, type Clock } from '../test/fakeAudio';
import { noAnimationFrames } from '../test/dom';
import { createCues } from './cues';

beforeEach(() => { noAnimationFrames(vi.stubGlobal); });

async function setup() {
  const clock: Clock = { t: 5_000 };
  const ctx = new FakeAudioContext(clock);
  const cues = createCues(cuesOptions(ctx, clock));
  await flush();
  const now = () => clock.t;
  const { result } = renderHook(() => useTimer(cues, { now }));
  const press = async (action: 'start' | 'pause' | 'toggle') => {
    act(() => { result.current[action](); });
    await flush(1);
  };
  return { clock, ctx, result, press };
}

const close = (a: number | undefined, b: number) => { expect(a).toBeCloseTo(b, 6); };

describe('timer ↔ warning cue sync', () => {
  it('pause/resume above 10 s: scheduled at currentTime + remaining lead', async () => {
    const { ctx, press } = await setup();
    await press('start');
    close(ctx.lastWarning?.started?.when, ctx.currentTime + 50);
    ctx.starts[0]?.end(); // the 1.9 s start cue finished
    ctx.advance(20_000);
    await press('pause');
    expect(ctx.liveWarnings).toHaveLength(0);
    expect(ctx.state).toBe('suspended');
    ctx.advance(5_000);
    await press('start');
    expect(ctx.state).toBe('running');
    expect(ctx.liveWarnings).toHaveLength(1);
    close(ctx.lastWarning?.started?.when, ctx.currentTime + 30);
    expect(ctx.lastWarning?.started?.offset).toBe(0);
  });

  it('pause at 7 s then resume: starts now at offset 3 s', async () => {
    const { ctx, press } = await setup();
    await press('start');
    ctx.advance(53_000);
    await press('pause');
    ctx.advance(2_000);
    await press('start');
    expect(ctx.liveWarnings).toHaveLength(1);
    close(ctx.lastWarning?.started?.when, ctx.currentTime);
    close(ctx.lastWarning?.started?.offset, 3);
  });

  it('resume at exactly 10.000 s: starts now at offset 0', async () => {
    const { ctx, press } = await setup();
    await press('start');
    ctx.advance(50_000);
    await press('pause');
    await press('start');
    close(ctx.lastWarning?.started?.when, ctx.currentTime);
    close(ctx.lastWarning?.started?.offset, 0);
  });

  it('several pause/resume cycles inside the last 10 s keep exactly one live source', async () => {
    const { ctx, press } = await setup();
    await press('start');
    ctx.advance(51_000);
    for (let i = 0; i < 4; i++) {
      await press('pause');
      ctx.advance(3_000);
      await press('start');
      ctx.advance(1_000);
      expect(ctx.liveWarnings).toHaveLength(1);
      close(ctx.lastWarning?.started?.offset, 1 + i);
    }
    expect(ctx.warnings.slice(0, -1).every((s) => s.stopped)).toBe(true);
  });

  it('pause 20 s with the context suspended, resume: scheduled on the post-resume clock', async () => {
    const { ctx, press } = await setup();
    await press('start');
    ctx.starts[0]?.end();
    ctx.advance(15_000);
    await press('pause'); // 45 s left
    expect(ctx.state).toBe('suspended');
    ctx.advance(20_000); // frozen audio clock
    await press('start');
    expect(ctx.state).toBe('running');
    expect(ctx.liveWarnings).toHaveLength(1);
    close(ctx.lastWarning?.started?.when, ctx.currentTime + 35);
  });

  it('crossing the 10 s mark with a cue 0.5 s off restarts it at the right offset', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const tick = () => { act(() => { for (const cb of frames.splice(0)) cb(0); }); };
    const { ctx, press } = await setup();
    await press('start');
    ctx.starts[0]?.end();
    tick(); // 60 s left: nothing to check
    expect(ctx.warnings).toHaveLength(1);
    ctx.advance(50_200);
    ctx.skew(0.5); // the audio clock jumped: the scheduled cue is 0.5 s early
    tick(); // first frame inside the last 10 s
    const [first, second] = ctx.warnings;
    expect(first?.stopped).toBe(true);
    close(second?.started?.when, ctx.currentTime);
    close(second?.started?.offset, 0.2);
    ctx.advance(1_000);
    tick(); // checked once per run segment
    expect(ctx.warnings).toHaveLength(2);
    expect(ctx.liveWarnings).toHaveLength(1);
  });

  it('a preset switch while running leaves no live warning', async () => {
    const { ctx, result } = await setup();
    act(() => { result.current.start(); });
    await flush(1);
    ctx.advance(55_000);
    act(() => { result.current.reset(30_000); });
    await flush(1);
    expect(ctx.liveWarnings).toHaveLength(0);
  });
});
