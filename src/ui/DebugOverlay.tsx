import { useEffect, useState } from 'react';
import type { CueElementInfo, Cues, CuesDebugInfo } from '../audio/cues';

interface DebugOverlayProps {
  cues: Cues | null;
  remainingMs: number;
}

const num = (n: number | null, dp: number) => (n === null ? '—' : n.toFixed(dp));

const element = (name: string, e: CueElementInfo | null) =>
  e === null
    ? `${name} none`
    : `${name} rs=${String(e.readyState)} ${e.paused ? 'paused' : 'playing'} t=${e.currentTime.toFixed(2)}${e.errorCode === null ? '' : ` err=${String(e.errorCode)}`}`;

/**
 * Opt-in audio diagnostics (`?debug` or `#debug`): what the cue engine thinks,
 * refreshed every frame, so a field report from a phone comes with numbers.
 * Loaded lazily; never part of the normal render.
 */
export default function DebugOverlay({ cues, remainingMs }: DebugOverlayProps) {
  const [info, setInfo] = useState<CuesDebugInfo | null>(() => cues?.debugInfo() ?? null);

  useEffect(() => {
    if (!cues) return;
    let id = 0;
    const frame = () => {
      setInfo(cues.debugInfo());
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(id); };
  }, [cues]);

  const lines = info
    ? [
        element('start', info.start),
        element('warn ', info.warning),
        `warn expected=${num(info.expectedOffset, 2)} drift=${num(info.drift, 2)}`,
        `seeks ${String(info.seeks)} last drift=${num(info.lastSeekDrift, 2)}`,
        `armed left=${info.remainingMs === null ? '—' : String(Math.round(info.remainingMs))} ms timeout=${info.timerPending ? 'pending' : 'none'}`,
        `remaining ${String(Math.round(remainingMs))} ms`,
        ...info.recent.map((m) => `! ${m}`),
      ]
    : ['no cue engine', `remaining ${String(Math.round(remainingMs))} ms`];

  return (
    <pre className="debug-overlay" aria-hidden="true">
      {lines.join('\n')}
    </pre>
  );
}
