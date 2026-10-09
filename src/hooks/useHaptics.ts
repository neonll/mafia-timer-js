import { useEffect, useRef } from 'react';
import type { TimerStatus } from '../core/timer';
import { FINISH_PATTERN, WARNING_PATTERN, vibrate } from '../haptics';

/**
 * Buzzes once per run when the warning starts (`warning`: running inside the
 * last ten seconds; a pause and resume after that does not buzz again) and
 * when the timer finishes.
 */
export function useHaptics(status: TimerStatus, warning: boolean): void {
  const warned = useRef(false);

  useEffect(() => {
    // A new run starts from idle or from finished.
    if (status === 'idle' || status === 'finished') warned.current = false;
    if (status === 'finished') vibrate(FINISH_PATTERN);
  }, [status]);

  useEffect(() => {
    if (!warning || warned.current) return;
    warned.current = true;
    vibrate(WARNING_PATTERN);
  }, [warning]);
}
