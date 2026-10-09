// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cues } from '../audio/cues';
import { restoreVisibility, setVisibility } from '../test/dom';
import { useTimer } from './useTimer';

afterEach(() => { restoreVisibility(); });

function fakeCues() {
  return {
    unlock: vi.fn(),
    playStart: vi.fn(),
    armWarning: vi.fn(),
    ensureWarning: vi.fn(),
    disarmWarning: vi.fn(),
    releaseWarning: vi.fn(),
    setMuted: vi.fn(),
    debugInfo: vi.fn(() => ({ start: null, warning: null, expectedOffset: null, drift: null, remainingMs: null, timerPending: false, seeks: 0, lastSeekDrift: null, recent: [] })),
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
    expect(cues.disarmWarning).toHaveBeenLastCalledWith(); // pause keeps the cue's position

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
    expect(cues.disarmWarning).toHaveBeenLastCalledWith(true); // reset rewinds the cue
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

describe('useTimer: warning sync', () => {
  it('calls ensureWarning on every frame inside the last ten seconds, not before', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    const { clock, cues, hook } = setup();
    const frame = (ms: number) => { clock.t += ms; act(() => { for (const cb of frames.splice(0)) cb(0); }); };
    act(() => { hook.result.current.start(); });
    frame(49_000);
    expect(cues.ensureWarning).not.toHaveBeenCalled();
    frame(1_000);
    frame(16);
    frame(16);
    expect(cues.ensureWarning).toHaveBeenCalledTimes(3);
    expect(cues.ensureWarning).toHaveBeenLastCalledWith(61_000);
  });

  it('syncs the warning once when the page becomes visible while running', () => {
    const { clock, cues, hook } = setup();
    act(() => { hook.result.current.start(); });
    clock.t += 55_000;
    vi.mocked(cues.ensureWarning).mockClear();
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(cues.ensureWarning).toHaveBeenCalledTimes(1);
    expect(cues.ensureWarning).toHaveBeenCalledWith(61_000);
  });
});

describe('useTimer: start cue', () => {
  it('start → reset → start plays it twice', () => {
    const { cues, hook } = setup();
    act(() => { hook.result.current.start(); });
    act(() => { hook.result.current.reset(); });
    act(() => { hook.result.current.start(); });
    expect(cues.playStart).toHaveBeenCalledTimes(2);
  });

  it('start → preset switch → start plays it twice', () => {
    const { cues, hook } = setup();
    act(() => { hook.result.current.start(); });
    act(() => { hook.result.current.reset(30_000); });
    act(() => { hook.result.current.start(); });
    expect(cues.playStart).toHaveBeenCalledTimes(2);
  });

  it('start → pause → start plays it once', () => {
    const { clock, cues, hook } = setup();
    act(() => { hook.result.current.start(); });
    clock.t += 3_000;
    act(() => { hook.result.current.pause(); });
    act(() => { hook.result.current.start(); });
    expect(cues.playStart).toHaveBeenCalledTimes(1);
  });
});

describe('useTimer: hidden page', () => {
  it('runs no rAF loop while hidden and recomputes the remaining time on becoming visible', () => {
    setVisibility('hidden', false);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { clock, hook } = setup();
    act(() => { hook.result.current.start(); });
    clock.t += 15_000;
    expect(raf).not.toHaveBeenCalled();
    expect(hook.result.current.remainingMs).toBe(60_000);

    act(() => { setVisibility('visible'); });
    expect(hook.result.current).toMatchObject({ status: 'running', remainingMs: 45_000 });
    expect(raf).toHaveBeenCalled();
  });

  it('stops the rAF loop when the page is hidden', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { hook } = setup();
    act(() => { hook.result.current.start(); });
    act(() => { setVisibility('hidden'); });
    expect(cancel).toHaveBeenCalled();
  });
});
