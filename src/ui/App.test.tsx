// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCues, type Cues } from '../audio/cues';
import { FakeAudioContext, cuesOptions, flush, type Clock } from '../test/fakeAudio';
import { noAnimationFrames, restoreVisibility, setVisibility } from '../test/dom';
import { App } from './App';

const fakeCues = (): Cues => ({
  unlock: vi.fn(),
  playStart: vi.fn(),
  armWarning: vi.fn(),
  disarmWarning: vi.fn(),
  releaseWarning: vi.fn(),
  setMuted: vi.fn(),
  dispose: vi.fn(),
});

beforeEach(() => { noAnimationFrames(vi.stubGlobal); });
afterEach(() => { localStorage.clear(); });

const digits = () => screen.getByRole('timer').textContent;
const main = () => screen.getByRole('main');
const button = (name: string) => screen.getByRole('button', { name });
/** The pointer-only tap target over the ring (hidden from assistive tech). */
const ringHit = () => document.querySelector('.ring-hit') as HTMLButtonElement;
/** Recompute the view from the clock (what the rAF loop does every frame). */
const tick = () => { act(() => { document.dispatchEvent(new Event('visibilitychange')); }); };

describe('App', () => {
  it('starts, pauses with Space, and resets', () => {
    const c = fakeCues();
    render(<App cues={c} />);
    expect(digits()).toBe('60');
    expect(button('Reset timer')).toHaveProperty('disabled', true);

    fireEvent.click(button('Start timer'));
    expect(c.playStart).toHaveBeenCalledOnce();
    expect(button('Pause timer')).toBeTruthy();

    act(() => { fireEvent.keyDown(document.body, { code: 'Space' }); });
    expect(button('Start timer')).toBeTruthy();

    fireEvent.click(button('Reset timer'));
    expect(digits()).toBe('60');
  });

  it('leaves Space to a focused control', () => {
    render(<App cues={fakeCues()} />);
    const mute = button('Mute');
    mute.focus();
    act(() => { fireEvent.keyDown(mute, { code: 'Space' }); });
    expect(button('Start timer')).toBeTruthy();
  });

  it('switches presets', () => {
    render(<App cues={fakeCues()} />);
    fireEvent.click(button('30 seconds'));
    expect(digits()).toBe('30');
    expect(button('30 seconds').getAttribute('aria-pressed')).toBe('true');
    expect(button('60 seconds').getAttribute('aria-pressed')).toBe('false');
  });

  it('persists mute and forwards it to the cues', () => {
    const c = fakeCues();
    render(<App cues={c} />);
    fireEvent.click(button('Mute'));
    expect(c.setMuted).toHaveBeenLastCalledWith(true);
    expect(localStorage.getItem('mafia-timer:muted')).toBe('1');
    expect(button('Unmute')).toBeTruthy();
  });

  it('starts muted from storage: the gain is 0 at unlock', async () => {
    localStorage.setItem('mafia-timer:muted', '1');
    const clock: Clock = { t: 0 };
    const ctx = new FakeAudioContext(clock);
    const cues = createCues(cuesOptions(ctx, clock));
    await flush();
    render(<App cues={cues} now={() => clock.t} />);
    expect(button('Unmute')).toBeTruthy();
    fireEvent.click(button('Start timer'));
    await flush(1);
    expect(ctx.state).toBe('running');
    expect(ctx.gainNode.gain.value).toBe(0);
  });

  it('tolerates a throwing localStorage', () => {
    const boom = () => { throw new Error('SecurityError'); };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, clear: () => undefined });
    render(<App cues={fakeCues()} />);
    fireEvent.click(button('Mute'));
    expect(button('Unmute')).toBeTruthy();
  });
});

describe('App: last ten seconds', () => {
  it('warns from exactly 10 000 ms left while running; clears on pause and finish', () => {
    const clock = { t: 0 };
    render(<App cues={fakeCues()} now={() => clock.t} />);
    const live = screen.getByText('', { selector: '[aria-live]' });

    fireEvent.click(button('Start timer'));
    clock.t = 49_999; // 10 001 ms left
    tick();
    expect(digits()).toBe('11');
    expect(main().hasAttribute('data-warning')).toBe(false);
    expect(live.textContent).toBe('');

    clock.t = 50_000; // 10 000 ms left
    tick();
    expect(digits()).toBe('10');
    expect(main().hasAttribute('data-warning')).toBe(true);
    expect(live.textContent).toBe('10 seconds left');

    clock.t = 51_000;
    tick();
    expect(digits()).toBe('09');

    fireEvent.click(button('Pause timer'));
    expect(main().hasAttribute('data-warning')).toBe(false);
    expect(live.textContent).toBe('10 seconds left');

    fireEvent.click(button('Start timer'));
    expect(main().hasAttribute('data-warning')).toBe(true);
    clock.t = 60_000;
    tick();
    expect(digits()).toBe('00');
    expect(main().hasAttribute('data-warning')).toBe(false);
    expect(live.textContent).toBe('Time is up');

    fireEvent.click(button('Reset timer'));
    expect(live.textContent).toBe('');
  });
});

describe('App: ring states', () => {
  const label = () => document.querySelector('.ring-label')?.textContent;
  const progressOffset = () => Number(document.querySelector('.ring-progress')?.getAttribute('stroke-dashoffset'));

  it('labels idle and running with the preset, paused with PAUSED', () => {
    const clock = { t: 0 };
    render(<App cues={fakeCues()} now={() => clock.t} />);
    expect(label()).toBe('60s');
    fireEvent.click(button('Start timer'));
    expect(label()).toBe('60s');

    clock.t = 5_000;
    fireEvent.click(button('Pause timer'));
    expect(label()).toMatch(/^paused$/i);
    expect(main().hasAttribute('data-paused')).toBe(true);
    expect(document.querySelector('.ring-label-dot')).toBeNull();

    fireEvent.click(button('Start timer'));
    expect(label()).toBe('60s');
    expect(main().hasAttribute('data-paused')).toBe(false);
  });

  it('holds a full red ring labelled TIME\'S UP once finished; reset clears it', () => {
    const clock = { t: 0 };
    render(<App cues={fakeCues()} now={() => clock.t} />);
    fireEvent.click(button('30 seconds'));
    fireEvent.click(button('Start timer'));
    clock.t = 30_000;
    tick();

    expect(digits()).toBe('00');
    expect(main().hasAttribute('data-finished')).toBe(true);
    expect(main().hasAttribute('data-warning')).toBe(false);
    expect(label()).toMatch(/^time's up$/i);
    expect(document.querySelector('.ring-label-dot')).toBeNull();
    expect(progressOffset()).toBe(0);

    fireEvent.click(button('Reset timer'));
    expect(main().hasAttribute('data-finished')).toBe(false);
    expect(label()).toBe('30s');
  });

  it('clears the finished hold on a new start', () => {
    const clock = { t: 0 };
    render(<App cues={fakeCues()} now={() => clock.t} />);
    fireEvent.click(button('Start timer'));
    clock.t = 60_000;
    tick();
    expect(main().hasAttribute('data-finished')).toBe(true);
    fireEvent.click(button('Start timer'));
    expect(main().hasAttribute('data-finished')).toBe(false);
    expect(label()).toBe('60s');
  });
});

describe('App: tap the ring', () => {
  it('starts and pauses like the primary button, without being an accessible control', () => {
    const clock = { t: 0 };
    const c = fakeCues();
    render(<App cues={c} now={() => clock.t} />);
    expect(ringHit().getAttribute('aria-hidden')).toBe('true');
    expect(ringHit().tabIndex).toBe(-1);
    expect(screen.getAllByRole('button', { name: /timer/ })).toHaveLength(2); // primary + reset
    expect(screen.getByRole('timer').closest('button')).toBeNull();

    fireEvent.click(ringHit());
    expect(c.unlock).toHaveBeenCalledOnce(); // synchronously inside the gesture
    expect(c.playStart).toHaveBeenCalledOnce();
    expect(button('Pause timer')).toBeTruthy();

    clock.t = 3_000;
    fireEvent.click(ringHit());
    expect(button('Start timer')).toBeTruthy();
    expect(digits()).toBe('57');
    expect(main().hasAttribute('data-paused')).toBe(true);
  });

  it('does nothing once time is up; the primary button restarts', () => {
    const clock = { t: 0 };
    const c = fakeCues();
    render(<App cues={c} now={() => clock.t} />);
    fireEvent.click(ringHit());
    clock.t = 60_000;
    tick();
    expect(main().hasAttribute('data-finished')).toBe(true);

    fireEvent.click(ringHit());
    expect(main().hasAttribute('data-finished')).toBe(true);
    expect(c.playStart).toHaveBeenCalledOnce();

    fireEvent.click(button('Start timer'));
    expect(main().hasAttribute('data-finished')).toBe(false);
    expect(c.playStart).toHaveBeenCalledTimes(2);
  });
});

describe('App: haptics', () => {
  let vibrate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'vibrate');
    restoreVisibility();
  });

  it('pulses when the warning starts and double-pulses at the finish', () => {
    const clock = { t: 0 };
    render(<App cues={fakeCues()} now={() => clock.t} />);
    fireEvent.click(button('Start timer'));
    clock.t = 49_999;
    tick();
    expect(vibrate).not.toHaveBeenCalled();

    clock.t = 50_000; // 10 000 ms left
    tick();
    expect(vibrate.mock.calls).toEqual([[40]]);
    clock.t = 55_000;
    tick();
    expect(vibrate).toHaveBeenCalledOnce();

    clock.t = 60_000;
    tick();
    expect(vibrate.mock.calls).toEqual([[40], [[60, 60, 60]]]);
  });

  it('ignores mute', () => {
    const clock = { t: 0 };
    render(<App cues={fakeCues()} now={() => clock.t} />);
    fireEvent.click(button('Mute'));
    fireEvent.click(button('Start timer'));
    clock.t = 50_000;
    tick();
    expect(vibrate.mock.calls).toEqual([[40]]);
  });

  it('pulses once on crossing when paused before the mark and resumed', () => {
    const clock = { t: 0 };
    render(<App cues={fakeCues()} now={() => clock.t} />);
    fireEvent.click(button('Start timer'));
    clock.t = 49_500; // 10.5 s left
    fireEvent.click(button('Pause timer'));
    clock.t = 80_000;
    fireEvent.click(button('Start timer'));
    expect(vibrate).not.toHaveBeenCalled();
    clock.t = 80_500; // crosses 10 000 ms while running
    tick();
    expect(vibrate.mock.calls).toEqual([[40]]);
  });

  it('does not pulse again when paused after the mark and resumed', () => {
    const clock = { t: 0 };
    render(<App cues={fakeCues()} now={() => clock.t} />);
    fireEvent.click(button('Start timer'));
    clock.t = 52_000;
    tick();
    expect(vibrate).toHaveBeenCalledOnce();
    fireEvent.click(button('Pause timer'));
    clock.t = 70_000;
    fireEvent.click(button('Start timer'));
    clock.t = 71_000;
    tick();
    expect(vibrate).toHaveBeenCalledOnce();
  });

  it('pulses again on the next run', () => {
    const clock = { t: 0 };
    render(<App cues={fakeCues()} now={() => clock.t} />);
    fireEvent.click(button('Start timer'));
    clock.t = 55_000;
    tick();
    fireEvent.click(button('Reset timer'));
    fireEvent.click(button('Start timer'));
    clock.t = 105_000;
    tick();
    expect(vibrate.mock.calls).toEqual([[40], [40]]);
  });

  it('stays silent for a finish that happened while the page was hidden', () => {
    const clock = { t: 0 };
    render(<App cues={fakeCues()} now={() => clock.t} />);
    fireEvent.click(button('Start timer'));
    clock.t = 40_000;
    act(() => { setVisibility('hidden'); });
    clock.t = 70_000; // the run ended unobserved
    act(() => { setVisibility('visible'); });
    expect(main().hasAttribute('data-finished')).toBe(true);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('stays silent for a warning crossed while hidden, and buzzes live again afterwards', () => {
    const clock = { t: 0 };
    render(<App cues={fakeCues()} now={() => clock.t} />);
    fireEvent.click(button('Start timer'));
    clock.t = 45_000;
    act(() => { setVisibility('hidden'); });
    clock.t = 52_000; // 8 s left on return
    act(() => { setVisibility('visible'); });
    expect(main().hasAttribute('data-warning')).toBe(true);
    expect(vibrate).not.toHaveBeenCalled();

    clock.t = 60_000;
    tick();
    expect(vibrate.mock.calls).toEqual([[[60, 60, 60]]]);
  });

  it('re-arms on every new run (preset switch mid-warning, then start)', () => {
    const clock = { t: 0 };
    render(<App cues={fakeCues()} now={() => clock.t} />);
    fireEvent.click(button('Start timer'));
    clock.t = 55_000;
    tick();
    fireEvent.click(button('30 seconds'));
    fireEvent.click(button('Start timer'));
    clock.t = 75_000;
    tick();
    expect(vibrate.mock.calls).toEqual([[40], [40]]);
  });
});
