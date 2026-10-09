// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cues } from '../audio/cues';
import { App } from './App';

const cues = (): Cues => ({
  unlock: vi.fn(),
  playStart: vi.fn(),
  armWarning: vi.fn(),
  disarmWarning: vi.fn(),
  releaseWarning: vi.fn(),
  setMuted: vi.fn(),
  dispose: vi.fn(),
});

afterEach(() => { cleanup(); localStorage.clear(); });

describe('App', () => {
  it('starts, pauses with Space, and resets', () => {
    const c = cues();
    render(<App cues={c} />);
    expect(screen.getByRole('timer').textContent).toBe('60');
    expect(screen.getByRole('button', { name: 'Reset timer' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
    expect(c.playStart).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Pause timer' })).toBeTruthy();

    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    expect(screen.getByRole('button', { name: 'Start timer' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reset timer' }));
    expect(screen.getByRole('timer').textContent).toBe('60');
  });

  it('switches presets', () => {
    render(<App cues={cues()} />);
    fireEvent.click(screen.getByRole('button', { name: '30s' }));
    expect(screen.getByRole('timer').textContent).toBe('30');
    expect(screen.getByRole('button', { name: '30s' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('persists mute and forwards it to the cues', () => {
    const c = cues();
    render(<App cues={c} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(c.setMuted).toHaveBeenLastCalledWith(true);
    expect(localStorage.getItem('mafia-timer:muted')).toBe('1');
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeTruthy();
  });
});
