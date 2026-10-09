/**
 * Haptic cues via the Vibration API (Android browsers). Feature-detected:
 * iOS Safari has no `navigator.vibrate`, so nothing happens there. Haptics are
 * independent of the audio mute. Nothing in here throws.
 */

/** A short pulse when a run enters its last ten seconds. */
export const WARNING_PATTERN: number = 40;
/** A double pulse when time is up. */
export const FINISH_PATTERN: readonly number[] = [60, 60, 60];

export function vibrate(pattern: number | readonly number[]): void {
  const nav = globalThis.navigator as Partial<Pick<Navigator, 'vibrate'>> | undefined;
  try {
    nav?.vibrate?.(typeof pattern === 'number' ? pattern : [...pattern]);
  } catch {
    // blocked (e.g. no user activation yet, or disabled by the user/OS)
  }
}
