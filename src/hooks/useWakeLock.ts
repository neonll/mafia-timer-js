import { useEffect } from 'react';

/**
 * Keeps the screen awake while `active`. The browser drops the lock whenever
 * the page is hidden, so it is re-requested when the page becomes visible
 * again. Feature-detected; failures are ignored (the timer works without it).
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = () => {
      if (document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      navigator.wakeLock.request('screen').then(
        (s) => {
          if (cancelled) {
            s.release().catch(() => undefined);
          } else {
            sentinel = s;
          }
        },
        () => undefined, // denied (battery saver, not allowed, …)
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
      sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [active]);
}
