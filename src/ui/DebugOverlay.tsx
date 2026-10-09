import { useEffect, useState } from 'react';
import type { Cues, CuesDebugInfo } from '../audio/cues';

interface DebugOverlayProps {
  cues: Cues | null;
  remainingMs: number;
}

const num = (n: number | null, dp: number) => (n === null ? '—' : n.toFixed(dp));

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
        `ctx ${info.state} t=${num(info.currentTime, 2)}`,
        `lat base=${num(info.baseLatency, 3)} out=${num(info.outputLatency, 3)}`,
        `warn fileStart=${num(info.fileStart, 2)} ${info.fileStart === null ? '' : info.warningPlaying ? 'playing' : 'pending'}`,
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
