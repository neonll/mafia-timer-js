/**
 * Pure countdown state machine. No React, no globals: every transition that
 * depends on time takes `now` (milliseconds on any monotonic clock, e.g.
 * `performance.now()`), so the whole thing is trivially testable.
 */

export const PRESET_FULL_MS = 60_000;
export const PRESET_HALF_MS = 30_000;
/** The warning cue is a 10-second countdown that ends exactly at zero. */
export const WARNING_MS = 10_000;

export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface TimerState {
  readonly durationMs: number;
  readonly status: TimerStatus;
  /** Time left. Authoritative unless `status === 'running'`. */
  readonly remainingMs: number;
  /** Clock value at which the run ends. Only meaningful while running. */
  readonly endAt: number;
}

export function createTimer(durationMs: number = PRESET_FULL_MS): TimerState {
  return { durationMs, status: 'idle', remainingMs: durationMs, endAt: 0 };
}

/** Milliseconds left at `now`, clamped to [0, durationMs]. */
export function remaining(s: TimerState, now: number): number {
  if (s.status !== 'running') return s.remainingMs;
  return Math.min(s.durationMs, Math.max(0, s.endAt - now));
}

/**
 * True when starting now begins a new run (rather than resuming a paused one):
 * idle at full duration, or finished. The start cue plays only on a fresh start.
 */
export function isFreshStart(s: TimerState): boolean {
  return s.status === 'finished' || (s.status === 'idle' && s.remainingMs === s.durationMs);
}

/** idle / paused / finished → running. A finished timer restarts from full. No-op while running. */
export function start(s: TimerState, now: number): TimerState {
  if (s.status === 'running') return s;
  const left = s.status === 'finished' || s.remainingMs <= 0 ? s.durationMs : s.remainingMs;
  return { ...s, status: 'running', remainingMs: left, endAt: now + left };
}

/** running → paused, freezing the remaining time. If time already ran out, settles to finished. */
export function pause(s: TimerState, now: number): TimerState {
  if (s.status !== 'running') return s;
  const left = remaining(s, now);
  if (left === 0) return finish(s);
  return { ...s, status: 'paused', remainingMs: left, endAt: 0 };
}

/** Any state → idle at full duration. Pass a new duration to switch presets. */
export function reset(s: TimerState, durationMs: number = s.durationMs): TimerState {
  return createTimer(durationMs);
}

/** running → finished once the clock has reached the end; otherwise unchanged. */
export function settle(s: TimerState, now: number): TimerState {
  if (s.status !== 'running' || remaining(s, now) > 0) return s;
  return finish(s);
}

function finish(s: TimerState): TimerState {
  return { ...s, status: 'finished', remainingMs: 0, endAt: 0 };
}
