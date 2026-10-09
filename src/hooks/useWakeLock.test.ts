// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush } from '../test/fakeAudio';
import { noAnimationFrames, restoreVisibility, setVisibility } from '../test/dom';
import { useTimer } from './useTimer';
import { useWakeLock } from './useWakeLock';

class FakeSentinel extends EventTarget {
  released = false;
  release = vi.fn(() => {
    if (!this.released) {
      this.released = true;
      this.dispatchEvent(new Event('release'));
    }
    return Promise.resolve();
  });
}

let sentinels: FakeSentinel[];
let request: ReturnType<typeof vi.fn<() => Promise<FakeSentinel>>>;

function installWakeLock(impl?: () => Promise<FakeSentinel>) {
  request = vi.fn(
    impl ??
      (() => {
        const s = new FakeSentinel();
        sentinels.push(s);
        return Promise.resolve(s);
      }),
  );
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
}

beforeEach(() => {
  sentinels = [];
  installWakeLock();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock');
  restoreVisibility();
});

const live = () => sentinels.filter((s) => !s.released);

describe('useWakeLock', () => {
  it('requests while active and releases when inactive', async () => {
    const hook = renderHook(({ active }) => { useWakeLock(active); }, { initialProps: { active: true } });
    await flush(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(live()).toHaveLength(1);
    hook.rerender({ active: false });
    expect(live()).toHaveLength(0);
  });

  it('re-requests on becoming visible, and never while hidden', async () => {
    renderHook(() => { useWakeLock(true); });
    await flush(1);
    // The browser drops the lock when the page is hidden.
    setVisibility('hidden');
    void sentinels[0]?.release();
    await flush(1);
    expect(request).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await flush(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(live()).toHaveLength(1);
  });

  it('does not request while hidden at start', async () => {
    setVisibility('hidden', false);
    renderHook(() => { useWakeLock(true); });
    await flush(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('re-requests when the sentinel is released while still active and visible', async () => {
    renderHook(() => { useWakeLock(true); });
    await flush(1);
    void sentinels[0]?.release(); // e.g. battery saver kicked in
    await flush(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(live()).toHaveLength(1);
  });

  it('two quick visibility events cannot create two sentinels', async () => {
    renderHook(() => { useWakeLock(true); });
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flush(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('releases a lock that resolves after cleanup', async () => {
    let resolve!: (s: FakeSentinel) => void;
    installWakeLock(() => new Promise((r) => { resolve = r; }));
    const hook = renderHook(() => { useWakeLock(true); });
    hook.unmount();
    const s = new FakeSentinel();
    resolve(s);
    await flush(1);
    expect(s.release).toHaveBeenCalled();
  });

  it('swallows a refusal (logged at debug level)', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    installWakeLock(() => Promise.reject(new Error('NotAllowedError')));
    renderHook(() => { useWakeLock(true); });
    await flush(1);
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without the API', () => {
    Reflect.deleteProperty(navigator, 'wakeLock');
    expect(() => renderHook(() => { useWakeLock(true); })).not.toThrow();
  });
});

describe('useTimer holds the wake lock only while running', () => {
  it('pause, reset and finish all release it', async () => {
    noAnimationFrames(vi.stubGlobal);
    const clock = { t: 0 };
    const now = () => clock.t;
    const { result } = renderHook(() => useTimer(null, { now }));
    const run = async (fn: () => void) => { act(fn); await flush(1); };

    await run(() => { result.current.start(); });
    expect(live()).toHaveLength(1);
    await run(() => { result.current.pause(); });
    expect(live()).toHaveLength(0);

    await run(() => { result.current.start(); });
    expect(live()).toHaveLength(1);
    await run(() => { result.current.reset(); });
    expect(live()).toHaveLength(0);

    await run(() => { result.current.start(); });
    expect(live()).toHaveLength(1);
    clock.t += 61_000;
    await run(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current.status).toBe('finished');
    expect(live()).toHaveLength(0);
  });
});
