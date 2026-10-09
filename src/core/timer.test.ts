import { describe, expect, it } from 'vitest';
import {
  PRESET_FULL_MS,
  PRESET_HALF_MS,
  createTimer,
  isFreshStart,
  pause,
  remaining,
  reset,
  settle,
  start,
} from './timer';

const T0 = 1_000; // arbitrary clock origin, to catch code that assumes now starts at 0

describe('createTimer', () => {
  it('defaults to the 60 s preset, idle at full', () => {
    const s = createTimer();
    expect(s).toMatchObject({ durationMs: PRESET_FULL_MS, status: 'idle', remainingMs: PRESET_FULL_MS });
    expect(remaining(s, T0)).toBe(PRESET_FULL_MS);
    expect(isFreshStart(s)).toBe(true);
  });

  it('accepts the 30 s preset', () => {
    expect(createTimer(PRESET_HALF_MS).remainingMs).toBe(PRESET_HALF_MS);
  });
});

describe('start', () => {
  it('counts down from the full duration against the injected clock', () => {
    const s = start(createTimer(), T0);
    expect(s.status).toBe('running');
    expect(remaining(s, T0)).toBe(60_000);
    expect(remaining(s, T0 + 1)).toBe(59_999);
    expect(remaining(s, T0 + 45_500)).toBe(14_500);
  });

  it('is a no-op while already running (does not move the end)', () => {
    const s = start(createTimer(), T0);
    expect(start(s, T0 + 5_000)).toBe(s);
  });

  it('never reports more than the duration, even if the clock goes backwards', () => {
    const s = start(createTimer(), T0);
    expect(remaining(s, T0 - 500)).toBe(60_000);
  });

  it('restarts from full when started from finished', () => {
    const finished = settle(start(createTimer(PRESET_HALF_MS), T0), T0 + 30_000);
    expect(finished.status).toBe('finished');
    expect(isFreshStart(finished)).toBe(true);
    const again = start(finished, T0 + 40_000);
    expect(again.status).toBe('running');
    expect(remaining(again, T0 + 40_000)).toBe(30_000);
    expect(remaining(again, T0 + 41_000)).toBe(29_000);
  });
});

describe('pause / resume', () => {
  it('freezes the remaining time while paused and keeps it on resume', () => {
    let s = start(createTimer(), T0);
    s = pause(s, T0 + 12_345);
    expect(s.status).toBe('paused');
    expect(remaining(s, T0 + 12_345)).toBe(47_655);
    // Time passing while paused changes nothing.
    expect(remaining(s, T0 + 999_999)).toBe(47_655);
    expect(settle(s, T0 + 999_999)).toBe(s);

    s = start(s, T0 + 100_000);
    expect(s.status).toBe('running');
    expect(remaining(s, T0 + 100_000)).toBe(47_655);
    expect(remaining(s, T0 + 110_000)).toBe(37_655);
  });

  it('a resume is not a fresh start', () => {
    const paused = pause(start(createTimer(), T0), T0 + 1_000);
    expect(isFreshStart(paused)).toBe(false);
  });

  it('pause is a no-op unless running', () => {
    const idle = createTimer();
    expect(pause(idle, T0)).toBe(idle);
    const paused = pause(start(idle, T0), T0 + 1);
    expect(pause(paused, T0 + 2)).toBe(paused);
  });

  it('resumes correctly after the 10 s mark', () => {
    let s = start(createTimer(PRESET_HALF_MS), T0);
    s = pause(s, T0 + 23_000); // 7 s left, inside the warning window
    expect(remaining(s, T0 + 23_000)).toBe(7_000);
    s = start(s, T0 + 60_000);
    expect(remaining(s, T0 + 60_000)).toBe(7_000);
    expect(remaining(s, T0 + 66_999)).toBe(1);
    expect(settle(s, T0 + 66_999).status).toBe('running');
    expect(settle(s, T0 + 67_000).status).toBe('finished');
  });

  it('pausing after the end has passed settles to finished instead', () => {
    const s = pause(start(createTimer(PRESET_HALF_MS), T0), T0 + 31_000);
    expect(s.status).toBe('finished');
    expect(s.remainingMs).toBe(0);
  });

  it('survives many pause/resume cycles without drift', () => {
    let s = start(createTimer(), T0);
    let now = T0;
    for (let i = 0; i < 10; i++) {
      now += 1_000; // run 1 s
      s = pause(s, now);
      now += 7_777; // sit paused
      s = start(s, now);
    }
    expect(remaining(s, now)).toBe(50_000);
  });
});

describe('settle (finish detection)', () => {
  it('stays running until remaining hits exactly 0, then finishes', () => {
    const s = start(createTimer(), T0);
    expect(settle(s, T0 + 59_999)).toBe(s);
    const done = settle(s, T0 + 60_000);
    expect(done.status).toBe('finished');
    expect(done.remainingMs).toBe(0);
    expect(remaining(done, T0 + 60_000)).toBe(0);
  });

  it('clamps at 0 when the clock overshoots (e.g. a backgrounded tab)', () => {
    const s = start(createTimer(), T0);
    expect(remaining(s, T0 + 600_000)).toBe(0);
    expect(settle(s, T0 + 600_000).status).toBe('finished');
  });

  it('is a no-op for idle and finished timers', () => {
    const idle = createTimer();
    expect(settle(idle, T0)).toBe(idle);
    const done = settle(start(idle, T0), T0 + 60_000);
    expect(settle(done, T0 + 70_000)).toBe(done);
  });
});

describe('reset', () => {
  it('returns to idle at full while running', () => {
    const s = reset(start(createTimer(), T0));
    expect(s).toMatchObject({ status: 'idle', remainingMs: 60_000, durationMs: 60_000 });
    expect(remaining(s, T0 + 50_000)).toBe(60_000);
    expect(isFreshStart(s)).toBe(true);
  });

  it('returns to idle at full from paused and finished', () => {
    const paused = pause(start(createTimer(), T0), T0 + 5_000);
    expect(reset(paused)).toMatchObject({ status: 'idle', remainingMs: 60_000 });
    const done = settle(start(createTimer(), T0), T0 + 60_000);
    expect(reset(done)).toMatchObject({ status: 'idle', remainingMs: 60_000 });
  });

  it('switches presets', () => {
    const s = reset(start(createTimer(PRESET_FULL_MS), T0), PRESET_HALF_MS);
    expect(s).toMatchObject({ status: 'idle', durationMs: 30_000, remainingMs: 30_000 });
    expect(remaining(start(s, T0), T0 + 1_000)).toBe(29_000);
  });
});

describe('isFreshStart', () => {
  it('is false for a running timer and true only at full idle or finished', () => {
    expect(isFreshStart(start(createTimer(), T0))).toBe(false);
    expect(isFreshStart(createTimer())).toBe(true);
    expect(isFreshStart(settle(start(createTimer(), T0), T0 + 60_000))).toBe(true);
  });
});
