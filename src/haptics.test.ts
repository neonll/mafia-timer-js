import { afterEach, describe, expect, it, vi } from 'vitest';
import { FINISH_PATTERN, WARNING_PATTERN, vibrate } from './haptics';

afterEach(() => { vi.unstubAllGlobals(); });

describe('vibrate', () => {
  it('forwards the pattern when the Vibration API exists', () => {
    const v = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate: v });
    vibrate(WARNING_PATTERN);
    vibrate(FINISH_PATTERN);
    expect(v.mock.calls).toEqual([[40], [[60, 60, 60]]]);
  });

  it('does nothing without it (iOS)', () => {
    vi.stubGlobal('navigator', {});
    expect(() => { vibrate(WARNING_PATTERN); }).not.toThrow();
  });

  it('swallows a throwing vibrate', () => {
    vi.stubGlobal('navigator', { vibrate: () => { throw new Error('blocked'); } });
    expect(() => { vibrate(FINISH_PATTERN); }).not.toThrow();
  });
});
