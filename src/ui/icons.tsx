interface IconProps {
  size?: number;
  color?: string;
}

export const PlayIcon = ({ size = 28, color = '#fff' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
    <path d="M9 5.5v17l13-8.5L9 5.5z" fill={color} />
  </svg>
);

export const PauseIcon = ({ size = 28, color = '#fff' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
    <rect x="8" y="6" width="4.5" height="16" rx="1" fill={color} />
    <rect x="15.5" y="6" width="4.5" height="16" rx="1" fill={color} />
  </svg>
);

export const StopIcon = ({ size = 22, color = '#fff' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
    <rect x="5" y="5" width="12" height="12" rx="1.5" fill={color} />
  </svg>
);

export const SoundIcon = ({ muted }: { muted: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M3 7v6h3l5 4V3L6 7H3z" fill="currentColor" />
    {muted ? (
      <path d="M14 7l5 6M19 7l-5 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    ) : (
      <path d="M14 6c1.5 1 1.5 7 0 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    )}
  </svg>
);
