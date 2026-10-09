import { memo, type ReactNode } from 'react';
import { PRESET_FULL_MS, PRESET_HALF_MS } from '../core/timer';
import { PauseIcon, PlayIcon, ResetIcon, SoundIcon } from './icons';

interface ControlsProps {
  durationMs: number;
  /** Idle at full duration: nothing to reset. */
  atStart: boolean;
  running: boolean;
  muted: boolean;
  onPreset: (durationMs: number) => void;
  onToggle: () => void;
  onReset: () => void;
  onToggleMute: () => void;
}

const PRESETS = [PRESET_FULL_MS, PRESET_HALF_MS] as const;

export const Controls = memo(function Controls(p: ControlsProps) {
  return (
    <div className="controls">
      <div className="presets">
        {PRESETS.map((ms) => (
          <PresetButton key={ms} seconds={ms / 1000} active={p.durationMs === ms} onClick={() => { p.onPreset(ms); }} />
        ))}
      </div>
      <div className="primary-row">
        <SecondaryButton onClick={p.onReset} disabled={p.atStart} ariaLabel="Reset timer">
          <ResetIcon />
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
});

function PresetButton({ seconds, active, onClick }: { seconds: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn-preset"
      data-active={active || undefined}
      aria-pressed={active}
      aria-label={`${String(seconds)} seconds`}
      onClick={onClick}
    >
      <span className="btn-preset-label">{seconds}s</span>
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
