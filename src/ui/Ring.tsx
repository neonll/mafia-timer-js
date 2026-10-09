import { PRESET_FULL_MS, type TimerStatus } from '../core/timer';

/** Geometry in SVG user units; the ring scales with its box (`--ring`). */
const SIZE = 280;
const STROKE = 3;
const R = (SIZE - STROKE - 16) / 2;
const C = 2 * Math.PI * R;
const TICKS = [0, 90, 180, 270] as const;

interface RingProps {
  status: TimerStatus;
  remainingMs: number;
  durationMs: number;
  /** Same start/pause toggle as the primary button (pointer-only shortcut). */
  onToggle: () => void;
}

/**
 * Tapping the ring starts/pauses: a transparent hit area over it, hidden from
 * assistive tech and out of the tab order (the primary button is the
 * accessible control; Space covers keyboards). Inert once time is up, so a tap
 * on TIME'S UP never restarts by accident.
 */
export function Ring({ status, remainingMs, durationMs, onToggle }: RingProps) {
  const display = Math.ceil(remainingMs / 1000);
  // Finished holds a full red ring rather than an empty one.
  const pct = status === 'finished' ? 1 : Math.max(0, Math.min(1, remainingMs / durationMs));

  // End-cap dot, as a percentage of the ring box.
  const angle = -Math.PI / 2 + pct * Math.PI * 2;
  const dotLeft = ((SIZE / 2 + Math.cos(angle) * R) / SIZE) * 100;
  const dotTop = ((SIZE / 2 + Math.sin(angle) * R) / SIZE) * 100;

  return (
    <div className="ring">
      <svg className="ring-svg" viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`} aria-hidden="true">
        <defs>
          <filter id="ring-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle className="ring-track" cx={SIZE / 2} cy={SIZE / 2} r={R} strokeWidth={STROKE} fill="none" />
        <circle
          className="ring-progress"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          filter="url(#ring-glow)"
        />
      </svg>

      {pct > 0.001 && pct < 0.999 && (
        <div className="ring-dot" style={{ left: `${String(dotLeft)}%`, top: `${String(dotTop)}%` }} />
      )}

      {TICKS.map((deg) => (
        <div key={deg} className="ring-tick" style={{ transform: `translate(-50%, -100%) rotate(${String(deg)}deg)` }}>
          <div className="ring-tick-mark" />
        </div>
      ))}

      <div className="ring-center">
        <div className="ring-digits" role="timer" aria-live="off" aria-label={`${String(display)} seconds left`}>
          {String(display).padStart(2, '0')}
        </div>
        <RingLabel status={status} durationMs={durationMs} />
      </div>

      <button
        type="button"
        className="ring-hit"
        tabIndex={-1}
        aria-hidden="true"
        disabled={status === 'finished'}
        onClick={onToggle}
      />
    </div>
  );
}

/** idle/running: the preset; paused: PAUSED; finished: TIME'S UP (uppercased by CSS). */
function RingLabel({ status, durationMs }: { status: TimerStatus; durationMs: number }) {
  if (status === 'finished') return <div className="ring-label" data-status="finished">{"Time's up"}</div>;
  if (status === 'paused') {
    return (
      <div className="ring-label" data-status="paused">
        <svg className="ring-label-glyph" width="9" height="10" viewBox="0 0 9 10" aria-hidden="true">
          <rect x="0" y="0" width="3" height="10" fill="currentColor" />
          <rect x="6" y="0" width="3" height="10" fill="currentColor" />
        </svg>
        Paused
      </div>
    );
  }
  return (
    <div className="ring-label">
      <span className="ring-label-dot" data-preset={durationMs === PRESET_FULL_MS ? 'full' : 'half'} />
      {durationMs / 1000}s
    </div>
  );
}
