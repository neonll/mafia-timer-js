import { useCallback, useEffect, useState } from 'react';
import { readStoredMute, storeMute, type Cues } from '../audio/cues';
import { useTimer } from '../hooks/useTimer';
import logoUrl from '../assets/mafia-logo.png';
import { Controls } from './Controls';
import { Ring } from './Ring';

export function App({ cues }: { cues: Cues | null }) {
  const t = useTimer(cues);
  const [muted, setMuted] = useState(readStoredMute);

  useEffect(() => {
    cues?.setMuted(muted);
    storeMute(muted);
  }, [cues, muted]);

  const { toggle, reset } = t;

  // Space toggles start/pause (desktop nicety). preventDefault also stops a
  // focused button from receiving the same keypress as a click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [toggle]);

  const onReset = useCallback(() => { reset(); }, [reset]);
  const onToggleMute = useCallback(() => { setMuted((m) => !m); }, []);

  const warning = Math.ceil(t.remainingMs / 1000) <= 10 && t.running;

  return (
    <main className="app" data-warning={warning || undefined}>
      <div className="ambient" aria-hidden="true" />
      <div className="logo-wrap">
        <img className="logo" src={logoUrl} alt="Mafia" />
      </div>
      <Ring remainingMs={t.remainingMs} durationMs={t.durationMs} />
      <Controls
        durationMs={t.durationMs}
        remainingMs={t.remainingMs}
        running={t.running}
        muted={muted}
        onPreset={reset}
        onToggle={toggle}
        onReset={onReset}
        onToggleMute={onToggleMute}
      />
    </main>
  );
}
