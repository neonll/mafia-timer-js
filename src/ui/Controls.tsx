import type { ReactNode } from 'react';
import { PRESET_FULL_MS, PRESET_HALF_MS } from '../core/timer';
import { PauseIcon, PlayIcon, SoundIcon, StopIcon } from './icons';

interface ControlsProps {
  durationMs: number;
  remainingMs: number;
  running: boolean;
  muted: boolean;
  onPreset: (durationMs: number) => void;
  onToggle: () => void;
  onReset: () => void;
  onToggleMute: () => void;
}

const PRESETS = [PRESET_FULL_MS, PRESET_HALF_MS] as const;

export function Controls(p: ControlsProps) {
  const atStart = p.remainingMs === p.durationMs && !p.running;
  return (
    <div className="controls">
      <div className="presets">
        {PRESETS.map((ms) => (
          <PresetButton key={ms} label={`${String(ms / 1000)}s`} active={p.durationMs === ms} onClick={() => { p.onPreset(ms); }} />
        ))}
      </div>
      <div className="primary-row">
        <SecondaryButton onClick={p.onReset} disabled={atStart} ariaLabel="Reset timer">
          <StopIcon size={18} />
        </SecondaryButton>
        <button
          type="button"
          className="btn-primary"
          data-running={p.running || undefined}
          onClick={p.onToggle}
          aria-label={p.running ? 'Pause timer' : 'Start timer'}
        >
          {p.running ? <PauseIcon size={30} color="#000" /> : <PlayIcon size={30} />}
        </button>
        <SecondaryButton onClick={p.onToggleMute} ghost={!p.muted} ariaLabel={p.muted ? 'Unmute' : 'Mute'}>
          <SoundIcon muted={p.muted} />
        </SecondaryButton>
      </div>
    </div>
  );
}

function PresetButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn-preset" data-active={active || undefined} aria-pressed={active} onClick={onClick}>
      <span className="btn-preset-label">{label}</span>
      {active && <span className="btn-preset-bar" />}
    </button>
  );
}

interface SecondaryButtonProps {
  children: ReactNode;
  onClick: () => void;
  ariaLabel: string;
  disabled?: boolean;
  ghost?: boolean;
}

function SecondaryButton({ children, onClick, ariaLabel, disabled = false, ghost = false }: SecondaryButtonProps) {
  return (
    <button
      type="button"
      className="btn-secondary"
      data-ghost={ghost || undefined}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
