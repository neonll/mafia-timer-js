import { useCallback, useEffect, useRef, useState } from 'react';
import type { Cues } from '../audio/cues';
import * as timer from '../core/timer';
import type { TimerState, TimerStatus } from '../core/timer';
import { useWakeLock } from './useWakeLock';

export interface TimerView {
  status: TimerStatus;
  durationMs: number;
  remainingMs: number;
}

export interface TimerControls extends TimerView {
  running: boolean;
  start: () => void;
  pause: () => void;
  toggle: () => void;
  /** Back to idle at full. Pass a duration to switch presets. */
  reset: (durationMs?: number) => void;
}

export interface UseTimerOptions {
  /** Monotonic clock in ms. Defaults to `performance.now()`. */
  now?: () => number;
  initialDurationMs?: number;
}

const defaultNow = () => performance.now();

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * React glue around the pure timer: the authoritative state lives in a ref, a
 * render mirror is updated from a rAF loop that only runs while the timer is
 * running and the page is visible. Cues and the wake lock follow the status.
 */
export function useTimer(cues: Cues | null, opts: UseTimerOptions = {}): TimerControls {
  const { now = defaultNow, initialDurationMs } = opts;
  const [initial] = useState(() => timer.createTimer(initialDurationMs));
  const stateRef = useRef<TimerState>(initial);
  const [view, setView] = useState<TimerView>(() => toView(initial, initial.remainingMs));
  const [visible, setVisible] = useState(isVisible);

  const commit = useCallback((s: TimerState, at: number) => {
    stateRef.current = s;
    setView(toView(s, timer.remaining(s, at)));
  }, []);

  /** Bring the state up to date with the clock; handles a finish that happened unobserved. */
  const sync = useCallback(() => {
    const at = now();
    const prev = stateRef.current;
    const next = timer.settle(prev, at);
    if (next !== prev) cues?.releaseWarning();
    commit(next, at);
  }, [commit, cues, now]);

  const start = useCallback(() => {
    const at = now();
    const prev = timer.settle(stateRef.current, at);
    if (prev.status === 'running') return;
    cues?.unlock(); // must stay synchronous inside the user gesture
    const fresh = timer.isFreshStart(prev);
    const next = timer.start(prev, at);
    if (fresh) cues?.playStart();
    cues?.armWarning(next.endAt);
    commit(next, at);
  }, [commit, cues, now]);

  const pause = useCallback(() => {
    const at = now();
    const next = timer.pause(stateRef.current, at);
    if (next.status === 'finished') cues?.releaseWarning();
    else cues?.disarmWarning();
    commit(next, at);
  }, [commit, cues, now]);

  const reset = useCallback(
    (durationMs?: number) => {
      cues?.disarmWarning();
      commit(timer.reset(stateRef.current, durationMs), now());
    },
    [commit, cues, now],
  );

  const toggle = useCallback(() => {
    if (stateRef.current.status === 'running') pause();
    else start();
  }, [pause, start]);

  // Track page visibility; on becoming visible, recompute from the clock at once.
  useEffect(() => {
    const onVisibility = () => {
      const v = isVisible();
      setVisible(v);
      if (v) sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); };
  }, [sync]);

  // rAF loop: only while running and visible.
  const running = view.status === 'running';
  useEffect(() => {
    if (!running || !visible) return;
    let id = 0;
    const frame = () => {
      const at = now();
      const s = stateRef.current;
      const next = timer.settle(s, at);
      if (next !== s) {
        cues?.releaseWarning();
        commit(next, at); // finished: the loop stops here
        return;
      }
      const left = timer.remaining(s, at);
      setView((v) => (v.remainingMs === left ? v : { ...v, remainingMs: left }));
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(id); };
  }, [running, visible, commit, cues, now]);

  useWakeLock(running);

  return { ...view, running, start, pause, toggle, reset };
}

function toView(s: TimerState, remainingMs: number): TimerView {
  return { status: s.status, durationMs: s.durationMs, remainingMs };
}
