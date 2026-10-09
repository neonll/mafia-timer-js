// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Cues } from '../audio/cues';
import { useTimer } from './useTimer';

function fakeCues() {
  return {
    unlock: vi.fn(),
    playStart: vi.fn(),
    armWarning: vi.fn(),
    disarmWarning: vi.fn(),
    releaseWarning: vi.fn(),
    setMuted: vi.fn(),
    dispose: vi.fn(),
  } satisfies Cues;
}

function setup() {
  const clock = { t: 1_000 };
  const cues = fakeCues();
  const now = () => clock.t;
  const hook = renderHook(() => useTimer(cues, { now }));
  return { clock, cues, hook };
}

describe('useTimer', () => {
  it('plays the start cue on a fresh start only, and arms the warning on every start', () => {
    const { clock, cues, hook } = setup();
    act(() => { hook.result.current.start(); });
    expect(hook.result.current.status).toBe('running');
    expect(cues.unlock).toHaveBeenCalledTimes(1);
    expect(cues.playStart).toHaveBeenCalledTimes(1);
    expect(cues.armWarning).toHaveBeenLastCalledWith(61_000);

    clock.t += 20_000;
    act(() => { hook.result.current.pause(); });
    expect(hook.result.current.status).toBe('paused');
    expect(hook.result.current.remainingMs).toBe(40_000);
    expect(cues.disarmWarning).toHaveBeenCalledTimes(1);

    clock.t += 5_000;
    act(() => { hook.result.current.toggle(); });
    expect(hook.result.current.status).toBe('running');
    expect(cues.playStart).toHaveBeenCalledTimes(1); // resume: no start cue
    expect(cues.armWarning).toHaveBeenLastCalledWith(clock.t + 40_000);
  });

  it('reset switches presets and cancels the warning', () => {
    const { cues, hook } = setup();
    act(() => { hook.result.current.start(); });
    act(() => { hook.result.current.reset(30_000); });
    expect(hook.result.current).toMatchObject({ status: 'idle', durationMs: 30_000, remainingMs: 30_000 });
    expect(cues.disarmWarning).toHaveBeenCalled();
  });

  it('settles to finished from the clock when the page becomes visible again', () => {
    const { clock, cues, hook } = setup();
    act(() => { hook.result.current.start(); });
    clock.t += 90_000;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(hook.result.current).toMatchObject({ status: 'finished', remainingMs: 0 });
    expect(cues.releaseWarning).toHaveBeenCalled();

    // Starting again from finished is a fresh start from full.
    act(() => { hook.result.current.start(); });
    expect(cues.playStart).toHaveBeenCalledTimes(2);
    expect(hook.result.current.remainingMs).toBe(60_000);
  });

  it('ticks via requestAnimationFrame while running', async () => {
    const { clock, hook } = setup();
    act(() => { hook.result.current.start(); });
    clock.t += 1_500;
    await vi.waitFor(() => { expect(hook.result.current.remainingMs).toBe(58_500); });
    clock.t += 60_000;
    await vi.waitFor(() => { expect(hook.result.current.status).toBe('finished'); });
  });
});
