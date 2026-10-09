import { useCallback, useEffect, useState } from 'react';
import { readStoredMute, storeMute, type Cues } from '../audio/cues';
import { WARNING_MS } from '../core/timer';
import { useTimer } from '../hooks/useTimer';
import logoUrl from '../assets/mafia-logo.png';
import { Controls } from './Controls';
import { Ring } from './Ring';

/** Elements that handle Space themselves (a focused button activates on Space). */
const SPACE_TARGETS = 'button, a, input, select, textarea, [contenteditable]';

interface AppProps {
  cues: Cues | null;
  /** Monotonic clock for the timer; tests inject one. */
  now?: () => number;
}

export function App({ cues, now }: AppProps) {
  const t = useTimer(cues, now ? { now } : {});
  const [muted, setMuted] = useState(readStoredMute);

  useEffect(() => {
    cues?.setMuted(muted);
    storeMute(muted);
  }, [cues, muted]);

  const { toggle, reset } = t;

  // Space toggles start/pause (desktop nicety), unless a control has focus and
  // will handle the key natively.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target instanceof Element && e.target.closest(SPACE_TARGETS)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [toggle]);

  const onReset = useCallback(() => { reset(); }, [reset]);
  const onToggleMute = useCallback(() => { setMuted((m) => !m); }, []);

  const inLastTen = t.remainingMs <= WARNING_MS;
  const warning = inLastTen && t.running;
  // Announced once each: the text only changes when a run enters the last ten
  // seconds and when it finishes (a reset clears it for the next run).
  const announcement =
    t.status === 'finished' ? 'Time is up' : inLastTen && t.status !== 'idle' ? '10 seconds left' : '';

  return (
    <main
      className="app"
      data-warning={warning || undefined}
      data-paused={t.status === 'paused' || undefined}
      data-finished={t.status === 'finished' || undefined}
    >
      <div className="ambient" aria-hidden="true" />
      <div className="logo-wrap">
        <img className="logo" src={logoUrl} alt="Mafia" />
      </div>
      <Ring status={t.status} remainingMs={t.remainingMs} durationMs={t.durationMs} onToggle={toggle} />
      <Controls
        durationMs={t.durationMs}
        atStart={t.remainingMs === t.durationMs && !t.running}
        running={t.running}
        muted={muted}
        onPreset={reset}
        onToggle={toggle}
        onReset={onReset}
        onToggleMute={onToggleMute}
      />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </main>
  );
}
