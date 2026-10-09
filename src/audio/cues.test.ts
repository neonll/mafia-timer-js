import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cuesOptions, microtasks } from '../test/fakeAudio';
import { createCues, type CuesOptions } from './cues';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => { vi.useRealTimers(); });

function setup(extra: Partial<CuesOptions> = {}) {
  const { opts, els } = cuesOptions(extra);
  const cues = createCues(opts);
  return { cues, ...els };
}

/** First tap: unlock, then let the priming play() settle. */
async function tap(cues: ReturnType<typeof createCues>) {
  cues.unlock();
  await microtasks();
}

const close = (a: number | undefined, b: number) => { expect(a).toBeCloseTo(b, 6); };

describe('elements', () => {
  it('are created up front with preload=auto and playsInline', () => {
    const { start, warning } = setup();
    for (const el of [start, warning]) {
      expect(el.preload).toBe('auto');
      expect(el.playsInline).toBe(true);
    }
  });

  it('without media element support everything is a silent no-op', () => {
    const cues = createCues({ createElement: () => null, doc: null, now: () => Date.now() });
    expect(() => {
      cues.unlock();
      cues.playStart();
      cues.armWarning(Date.now() + 5_000);
      cues.ensureWarning(Date.now() + 5_000);
      cues.setMuted(true);
      cues.releaseWarning();
      cues.disarmWarning(true);
      cues.debugInfo();
      cues.dispose();
    }).not.toThrow();
  });
});

describe('unlock', () => {
  it('primes only the warning, once, with a muted play that is undone when it settles', async () => {
    const { cues, start, warning } = setup();
    cues.unlock();
    expect(start.plays).toEqual([]);
    expect(warning.plays).toEqual([{ at: 0, muted: true }]);
    expect(warning.muted).toBe(true);
    await microtasks();
    expect(warning.paused).toBe(true);
    expect(warning.currentTime).toBe(0);
    expect(warning.muted).toBe(false);
    cues.unlock();
    await microtasks();
    expect(warning.plays).toHaveLength(1);
    expect(start.plays).toEqual([]);
  });

  it('restores the mute setting current when priming settles', async () => {
    const { cues, warning } = setup();
    cues.unlock();
    cues.setMuted(true);
    await microtasks();
    expect(warning.muted).toBe(true);
  });

  it('the start cue in the same tap plays straight away, unmuted', async () => {
    const { cues, start } = setup();
    cues.unlock();
    cues.playStart();
    await microtasks();
    expect(start.audible).toBe(true);
    expect(start.plays).toEqual([{ at: 0, muted: false }]);
  });

  it('reloads an element that errored or never loaded, on every unlock', async () => {
    const { cues, start, warning } = setup();
    warning.error = { code: 2 } as MediaError;
    start.readyState = 0;
    await tap(cues);
    expect(warning.loads).toBe(1);
    expect(start.loads).toBe(1);
    start.readyState = 4;
    warning.error = { code: 4 } as MediaError;
    await tap(cues);
    expect(warning.loads).toBe(2);
    expect(start.loads).toBe(1);
  });
});

describe('start cue', () => {
  it('plays from the top, and not while muted', async () => {
    const { cues, start } = setup();
    await tap(cues);
    start.currentTime = 1.5;
    cues.playStart();
    expect(start.audiblePlays).toEqual([0]);
    cues.setMuted(true);
    cues.playStart();
    expect(start.plays).toHaveLength(1);
  });

  it('a muted startup skips it', async () => {
    const { cues, start } = setup({ muted: true });
    await tap(cues);
    cues.playStart();
    expect(start.plays).toEqual([]);
    expect(start.muted).toBe(true);
  });
});

describe('warning timeline', () => {
  it('armed at 60 s: fires at exactly T−10 s and plays from offset 0', async () => {
    const { cues, warning } = setup();
    await tap(cues);
    cues.armWarning(Date.now() + 60_000);
    expect(cues.debugInfo().timerPending).toBe(true);
    vi.advanceTimersByTime(49_999);
    expect(warning.audiblePlays).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(warning.audiblePlays).toEqual([0]);
    expect(warning.audible).toBe(true);
    expect(cues.debugInfo().timerPending).toBe(false);
  });

  it('pause at 15 s: paused, no timer; resume at 15 s fires 5 s later', async () => {
    const { cues, warning } = setup();
    await tap(cues);
    cues.armWarning(Date.now() + 60_000);
    vi.advanceTimersByTime(45_000);
    cues.disarmWarning();
    expect(warning.paused).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(30_000); // a long pause
    expect(warning.audiblePlays).toEqual([]);
    cues.armWarning(Date.now() + 15_000);
    vi.advanceTimersByTime(4_999);
    expect(warning.audiblePlays).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(warning.audiblePlays).toEqual([0]);
  });

  it('pause at 6 s pauses the cue; resume at 6 s plays from offset 4.0', async () => {
    const { cues, warning } = setup();
    await tap(cues);
    cues.armWarning(Date.now() + 12_000);
    vi.advanceTimersByTime(2_000);
    warning.advance(4); // played to 6 s left
    vi.advanceTimersByTime(4_000);
    cues.disarmWarning();
    expect(warning.paused).toBe(true);
    vi.advanceTimersByTime(10_000);
    warning.currentTime = 3.9; // where it actually stopped
    cues.armWarning(Date.now() + 6_000);
    expect(warning.audible).toBe(true);
    close(warning.currentTime, 4);
    close(warning.audiblePlays.at(-1), 4);
  });

  it('re-arming outside the window pauses a cue left playing', async () => {
    const { cues, warning } = setup();
    await tap(cues);
    cues.armWarning(Date.now() + 5_000);
    expect(warning.audible).toBe(true);
    cues.armWarning(Date.now() + 60_000);
    expect(warning.paused).toBe(true);
  });

  it('reset pauses and rewinds', async () => {
    const { cues, warning } = setup();
    await tap(cues);
    cues.armWarning(Date.now() + 5_000);
    warning.advance(2);
    cues.disarmWarning(true);
    expect(warning.paused).toBe(true);
    expect(warning.currentTime).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('mute mid-countdown mutes both elements at once and keeps the countdown going', async () => {
    const { cues, start, warning } = setup();
    await tap(cues);
    cues.armWarning(Date.now() + 8_000);
    cues.setMuted(true);
    expect(start.muted).toBe(true);
    expect(warning.muted).toBe(true);
    expect(warning.paused).toBe(false);
    cues.setMuted(false);
    expect(warning.audible).toBe(true);
  });
});

describe('ensureWarning (sync)', () => {
  async function playingAt(left: number) {
    const s = setup();
    await tap(s.cues);
    const endAt = Date.now() + left;
    s.cues.armWarning(endAt);
    await microtasks(); // the play() settles
    return { ...s, endAt };
  }

  it('is a no-op while in sync, and outside the last ten seconds', async () => {
    const { cues, warning, endAt } = await playingAt(8_000);
    const seeks = warning.seeks.length;
    vi.advanceTimersByTime(1_000);
    warning.advance(1);
    cues.ensureWarning(endAt);
    expect(warning.seeks).toHaveLength(seeks);
    expect(warning.plays).toHaveLength(2); // priming + one start

    const other = setup();
    await tap(other.cues);
    other.cues.ensureWarning(Date.now() + 20_000);
    expect(other.warning.audiblePlays).toEqual([]);
  });

  it('drift of 0.2 s is left alone; 0.5 s is seeked; a second seek within 1 s is skipped', async () => {
    const { cues, warning, endAt } = await playingAt(8_000);
    vi.advanceTimersByTime(1_000);
    warning.advance(1.2); // 0.2 s ahead
    const seeks = warning.seeks.length;
    cues.ensureWarning(endAt);
    expect(warning.seeks).toHaveLength(seeks);

    warning.advance(0.3); // 0.5 s ahead
    cues.ensureWarning(endAt);
    expect(warning.seeks).toHaveLength(seeks + 1);
    close(warning.currentTime, 3);

    vi.advanceTimersByTime(500);
    warning.advance(1); // 0.5 s ahead again, only 500 ms after the last seek
    cues.ensureWarning(endAt);
    expect(warning.seeks).toHaveLength(seeks + 1);

    vi.advanceTimersByTime(500);
    warning.advance(0.5); // 1 s since the last seek and still 0.5 s ahead: seeks again
    cues.ensureWarning(endAt);
    expect(warning.seeks).toHaveLength(seeks + 2);
    expect(cues.debugInfo().recent.at(-1)).toContain('drift');
  });

  it('restarts a cue that stopped (or ended early) at the matching offset', async () => {
    const { cues, warning, endAt } = await playingAt(9_000);
    vi.advanceTimersByTime(2_000);
    warning.pause(); // e.g. the OS took the audio away
    cues.ensureWarning(endAt);
    expect(warning.audible).toBe(true);
    close(warning.audiblePlays.at(-1), 3);
  });

  it('does not seek while a play() is still starting up', async () => {
    const { cues, warning } = setup();
    await tap(cues);
    warning.nextPlay = 'hold';
    const endAt = Date.now() + 9_000;
    cues.armWarning(endAt);
    vi.advanceTimersByTime(700); // currentTime has not moved yet
    const seeks = warning.seeks.length;
    cues.ensureWarning(endAt);
    expect(warning.seeks).toHaveLength(seeks);
    warning.settle();
    await microtasks();
    cues.ensureWarning(endAt);
    expect(warning.seeks).toHaveLength(seeks + 1);
    close(warning.currentTime, 1.7);
  });

  it('a play() that never settles stops blocking the sync after a second', async () => {
    const { cues, warning } = setup();
    await tap(cues);
    warning.nextPlay = 'hold';
    const endAt = Date.now() + 9_000;
    cues.armWarning(endAt);
    vi.advanceTimersByTime(999);
    const seeks = warning.seeks.length;
    cues.ensureWarning(endAt);
    expect(warning.seeks).toHaveLength(seeks);
    vi.advanceTimersByTime(1);
    cues.ensureWarning(endAt);
    expect(warning.seeks).toHaveLength(seeks + 1);
  });

  it('a refused play() is logged with the element name and retried at most once a second', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { cues, warning } = setup();
    await tap(cues);
    warning.nextPlay = 'reject';
    const endAt = Date.now() + 9_000;
    cues.armWarning(endAt);
    await microtasks();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('warning cue: play() was refused'), expect.any(Error));
    expect(warning.paused).toBe(true);
    const plays = warning.plays.length;
    vi.advanceTimersByTime(500);
    cues.ensureWarning(endAt);
    expect(warning.plays).toHaveLength(plays);
    vi.advanceTimersByTime(500);
    cues.ensureWarning(endAt);
    expect(warning.plays).toHaveLength(plays + 1);
    close(warning.currentTime, 2);
  });

  it('becoming visible inside the window syncs the cue', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' }) as unknown as Document & { visibilityState: string };
    const { cues, warning } = setup({ doc });
    await tap(cues);
    cues.armWarning(Date.now() + 30_000);
    vi.advanceTimersByTime(22_000);
    await microtasks();
    warning.pause(); // backgrounded: iOS paused the media
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(warning.paused).toBe(true); // still hidden
    (doc as { visibilityState: string }).visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(warning.audible).toBe(true);
    close(warning.currentTime, 2);
  });
});

describe('finish', () => {
  it('seen live: the cue rings out', async () => {
    const { cues, warning } = setup();
    await tap(cues);
    cues.armWarning(Date.now() + 5_000);
    vi.advanceTimersByTime(5_016); // one frame late
    cues.releaseWarning();
    expect(warning.audible).toBe(true);
    expect(cues.debugInfo().remainingMs).toBeNull();
  });

  it('seen late (back from the background): the cue is paused', async () => {
    const { cues, warning } = setup();
    await tap(cues);
    cues.armWarning(Date.now() + 5_000);
    vi.advanceTimersByTime(6_000);
    cues.releaseWarning();
    expect(warning.paused).toBe(true);
  });

  it('a late finish before the window cancels the pending start', async () => {
    const { cues, warning } = setup();
    await tap(cues);
    cues.armWarning(Date.now() + 60_000);
    cues.releaseWarning();
    vi.advanceTimersByTime(60_000);
    expect(warning.audiblePlays).toEqual([]);
  });
});

describe('debugInfo', () => {
  it('reports the elements, the expected offset and the drift', async () => {
    const { cues, warning } = setup();
    await tap(cues);
    cues.armWarning(Date.now() + 7_000);
    await microtasks();
    vi.advanceTimersByTime(1_000);
    warning.advance(1.25);
    const info = cues.debugInfo();
    expect(info.warning).toMatchObject({ readyState: 4, paused: false, currentTime: 4.25, errorCode: null });
    close(info.expectedOffset ?? NaN, 4);
    close(info.drift ?? NaN, 0.25);
    expect(info.remainingMs).toBe(6_000);
    expect(info.timerPending).toBe(false);
  });
});
