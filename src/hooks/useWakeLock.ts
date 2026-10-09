import { useEffect } from 'react';

/**
 * Keeps the screen awake while `active`. The browser drops the lock whenever
 * the page is hidden (and may drop it at other times, e.g. battery saver), so
 * it is re-requested when the page becomes visible again or the sentinel
 * reports a release while still active. Feature-detected; failures are only
 * logged at debug level (the timer works without it).
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let inFlight = false;
    let cancelled = false;

    const request = () => {
      if (cancelled || inFlight || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      inFlight = true;
      navigator.wakeLock.request('screen').then(
        (s) => {
          inFlight = false;
          if (cancelled) {
            s.release().catch(() => undefined);
            return;
          }
          sentinel = s;
          s.addEventListener('release', () => {
            if (sentinel === s) sentinel = null;
            request(); // no-op unless still active and visible
          });
        },
        (err: unknown) => {
          inFlight = false;
          console.debug('[wake-lock] request refused', err);
        },
      );
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') request();
    };

    request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const s = sentinel;
      sentinel = null;
      s?.release().catch(() => undefined);
    };
  }, [active]);
}
