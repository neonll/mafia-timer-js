// @vitest-environment jsdom
// Integration: the real cue engine driven by the real useTimer, against fake media elements.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimer } from '../hooks/useTimer';
import { cuesOptions, microtasks } from '../test/fakeAudio';
import { restoreVisibility, setVisibility } from '../test/dom';
import { createCues } from './cues';

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  restoreVisibility();
});

function setup() {
  const { opts, els } = cuesOptions();
  const cues = createCues(opts);
  const now = () => Date.now();
  const { result } = renderHook(() => useTimer(cues, { now }));
  const press = async (action: 'start' | 'pause' | 'toggle') => {
    act(() => { result.current[action](); });
    await act(() => microtasks());
  };
  /** Let `ms` pass on the clock (firing timers), then run one animation frame. */
  const tick = (ms = 0) => {
    act(() => {
      vi.advanceTimersByTime(ms);
      for (const cb of frames.splice(0)) cb(0);
    });
  };
  return { cues, result, press, tick, ...els };
}

const close = (a: number | undefined, b: number) => { expect(a).toBeCloseTo(b, 6); };

describe('timer ↔ warning cue sync', () => {
  it('fresh start: start cue now, warning from offset 0 at exactly 10 s left', async () => {
    const { start, warning, press, tick } = setup();
    await press('start');
    expect(start.audiblePlays).toEqual([0]);
    tick(49_999);
    expect(warning.audiblePlays).toEqual([]);
    tick(1);
    expect(warning.audiblePlays).toEqual([0]);
    expect(warning.audible).toBe(true);
  });

  it('pause at 15 s, resume: the warning starts 5 s later from offset 0', async () => {
    const { start, warning, press, tick } = setup();
    await press('start');
    tick(45_000);
    await press('pause');
    tick(20_000);
    await press('start');
    expect(start.audiblePlays).toEqual([0]); // resume: no start cue
    tick(4_999);
    expect(warning.audiblePlays).toEqual([]);
    tick(1);
    expect(warning.audiblePlays).toEqual([0]);
  });

  it('pause at 6 s pauses the cue; resume plays from offset 4.0 inside the tap', async () => {
    const { warning, press, tick } = setup();
    await press('start');
    tick(54_000);
    expect(warning.audible).toBe(true);
    await press('pause');
    expect(warning.paused).toBe(true);
    tick(5_000);
    await press('start');
    expect(warning.audible).toBe(true);
    close(warning.audiblePlays.at(-1), 4);
  });

  it('several pause/resume cycles inside the last 10 s resume at the right offset each time', async () => {
    const { warning, press, tick } = setup();
    await press('start');
    tick(51_000);
    for (let i = 0; i < 4; i++) {
      await press('pause');
      tick(3_000);
      await press('start');
      expect(warning.audible).toBe(true);
      close(warning.audiblePlays.at(-1), 1 + i);
      tick(1_000);
      warning.advance(1);
    }
  });

  it('every frame inside the window re-syncs: a 0.5 s drift is seeked back', async () => {
    const { warning, press, tick } = setup();
    await press('start');
    tick(50_000);
    await act(() => microtasks());
    const seeks = warning.seeks.length;
    tick(16);
    warning.advance(0.016);
    expect(warning.seeks).toHaveLength(seeks); // in sync: nothing to do
    warning.advance(0.5);
    tick(16);
    expect(warning.seeks).toHaveLength(seeks + 1);
    close(warning.currentTime, 0.032);
  });

  it('back from the background inside the window: plays from the matching offset', async () => {
    const { warning, press, tick } = setup();
    await press('start');
    act(() => { setVisibility('hidden'); });
    tick(52_000);
    await act(() => microtasks());
    warning.pause(); // iOS paused the media in the background
    act(() => { setVisibility('visible'); });
    expect(warning.audible).toBe(true);
    close(warning.audiblePlays.at(-1), 2);
  });

  it('a live finish rings out; a preset switch while running pauses and rewinds', async () => {
    const a = setup();
    await a.press('start');
    a.tick(55_000);
    a.tick(5_010);
    expect(a.result.current.status).toBe('finished');
    expect(a.warning.audible).toBe(true);

    const b = setup();
    await b.press('start');
    b.tick(55_000);
    act(() => { b.result.current.reset(30_000); });
    expect(b.warning.paused).toBe(true);
    expect(b.warning.currentTime).toBe(0);
  });
});
