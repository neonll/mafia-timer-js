import { useEffect, useRef } from 'react';
import { WARNING_MS, type TimerStatus } from '../core/timer';
import { FINISH_PATTERN, WARNING_PATTERN, vibrate } from '../haptics';

const isVisible = () => document.visibilityState === 'visible';

/**
 * Buzzes once per run when the warning starts (`warning`: running inside the
 * last ten seconds; a pause and resume after that does not buzz again) and
 * when the timer finishes. Only crossings seen live buzz: if the page was
 * hidden in between (screen off, app in the background), a warning or finish
 * noticed on return stays silent.
 */
export function useHaptics(status: TimerStatus, remainingMs: number, warning: boolean): void {
  const warned = useRef(false);
  /** The page has been hidden since the last render observed while visible. */
  const missed = useRef(false);

  useEffect(() => {
    const onVisibility = () => {
      if (!isVisible()) missed.current = true;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  // Re-arm whenever there is more than the warning window left (every new run).
  useEffect(() => {
    if (remainingMs > WARNING_MS) warned.current = false;
  }, [remainingMs]);

  useEffect(() => {
    if (!warning || warned.current) return;
    warned.current = true;
    if (isVisible() && !missed.current) vibrate(WARNING_PATTERN);
  }, [warning]);

  useEffect(() => {
    if (status === 'finished' && isVisible() && !missed.current) vibrate(FINISH_PATTERN);
  }, [status]);

  // Runs last on every render: a visible render has caught up with the clock.
  useEffect(() => {
    if (isVisible()) missed.current = false;
  });
}
