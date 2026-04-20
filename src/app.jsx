// Mafia Timer — Classic (refined)
// Single polished variant. Tweakable accent color, ring style, type.

const FULL = 60;
const HALF = 30;

function useTimer({ muted } = {}) {
  const [duration, setDuration] = React.useState(FULL);
  const [remainingMs, setRemainingMs] = React.useState(FULL * 1000);
  const remainingRef = React.useRef(remainingMs);
  const [running, setRunning] = React.useState(false);
  const endAtRef = React.useRef(null);
  const rafRef = React.useRef(null);
  const warnTimerRef = React.useRef(null);
  const startSndRef = React.useRef(null);
  const warnSndRef = React.useRef(null);
  const warnPlayedRef = React.useRef(false);
  const warnPrimedRef = React.useRef(false);
  const mutedRef = React.useRef(muted);
  React.useEffect(() => { mutedRef.current = muted; }, [muted]);

  // init audio elements once
  React.useEffect(() => {
    startSndRef.current = new Audio('assets/sound_start.mp3');
    warnSndRef.current = new Audio('assets/sound_10sec.mp3');
    startSndRef.current.preload = 'auto';
    warnSndRef.current.preload = 'auto';
  }, []);

  const pauseWarn = () => {
    const w = warnSndRef.current;
    if (w) { try { w.pause(); } catch (e) {} }
  };
  const stopWarn = () => {
    const w = warnSndRef.current;
    if (w) { try { w.pause(); w.currentTime = 0; } catch (e) {} }
  };

  const clearWarnTimer = () => {
    if (warnTimerRef.current != null) {
      clearTimeout(warnTimerRef.current);
      warnTimerRef.current = null;
    }
  };
  const scheduleWarn = () => {
    clearWarnTimer();
    if (warnPlayedRef.current) return;
    if (remainingRef.current <= 0) return;
    const lead = Math.max(0, remainingRef.current - 10000);
    warnTimerRef.current = setTimeout(() => {
      warnTimerRef.current = null;
      if (warnPlayedRef.current) return;
      warnPlayedRef.current = true;
      const w = warnSndRef.current;
      if (w && !mutedRef.current) {
        try { w.currentTime = 0; w.play().catch(() => {}); } catch (e) {}
      }
    }, lead);
  };

  const updateRemaining = (ms) => { remainingRef.current = ms; setRemainingMs(ms); };

  const tick = React.useCallback(() => {
    if (endAtRef.current == null) return;
    const left = Math.max(0, endAtRef.current - performance.now());
    updateRemaining(left);
    if (left <= 0) {
      setRunning(false);
      endAtRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  React.useEffect(() => {
    if (running) {
      endAtRef.current = performance.now() + remainingRef.current;
      rafRef.current = requestAnimationFrame(tick);
      scheduleWarn();
    } else {
      cancelAnimationFrame(rafRef.current);
      clearWarnTimer();
      endAtRef.current = null;
    }
    return () => { cancelAnimationFrame(rafRef.current); clearWarnTimer(); };
  }, [running]);

  const start = () => {
    // Fresh start = beginning of a new run (full remaining, or the timer
    // finished and we're restarting). Everything else is a resume.
    const fresh = remainingMs <= 0 || remainingMs === duration * 1000;
    if (remainingMs <= 0) updateRemaining(duration * 1000);
    if (fresh) {
      warnPlayedRef.current = false;
      const s = startSndRef.current;
      if (s && !mutedRef.current) {
        try { s.currentTime = 0; s.play().catch(()=>{}); } catch (e) {}
      }
    } else if (warnPlayedRef.current && !mutedRef.current) {
      // Resume the 10-sec warn from where pause() left it.
      const w = warnSndRef.current;
      if (w && !w.ended) {
        try { w.play().catch(() => {}); } catch (e) {}
      }
    }
    // Prime the warn audio element so iOS Safari allows later RAF-triggered playback.
    if (!warnPrimedRef.current) {
      const w = warnSndRef.current;
      if (w) {
        try {
          const prev = w.muted;
          w.muted = true;
          const p = w.play();
          const restore = () => { try { w.pause(); w.currentTime = 0; w.muted = prev; } catch (e) {} };
          if (p && typeof p.then === 'function') p.then(restore, restore);
          else restore();
        } catch (e) {}
        warnPrimedRef.current = true;
      }
    }
    setRunning(true);
  };
  const pause = () => {
    setRunning(false);
    pauseWarn();
  };
  const reset = (sec) => {
    setRunning(false);
    setDuration(sec);
    updateRemaining(sec * 1000);
    warnPlayedRef.current = false;
    stopWarn();
  };

  return { duration, remainingMs, running, start, pause, reset };
}

const PlayIcon = ({ size = 28, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
    <path d="M9 5.5v17l13-8.5L9 5.5z" fill={color}/>
  </svg>
);
const PauseIcon = ({ size = 28, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
    <rect x="8" y="6" width="4.5" height="16" rx="1" fill={color}/>
    <rect x="15.5" y="6" width="4.5" height="16" rx="1" fill={color}/>
  </svg>
);
const StopIcon = ({ size = 22, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 22 22"><rect x="5" y="5" width="12" height="12" rx="1.5" fill={color}/></svg>
);

function VariantClassic({ accent = '#E63946', digitFont = 'mono' }) {
  const [muted, setMuted] = React.useState(false);
  const t = useTimer({ muted });
  const sec = t.remainingMs / 1000;
  const display = Math.ceil(sec);
  const pct = Math.max(0, Math.min(1, t.remainingMs / (t.duration * 1000)));
  const warning = display <= 10 && t.running;
  const ringSize = 280;
  const stroke = 3;
  const r = (ringSize - stroke - 16) / 2;
  const C = 2 * Math.PI * r;

  // end-cap dot position
  const angle = -Math.PI / 2 + pct * Math.PI * 2;
  const dotX = ringSize / 2 + Math.cos(angle) * r;
  const dotY = ringSize / 2 + Math.sin(angle) * r;

  const digitFontFamily = digitFont === 'serif'
    ? '"Fraunces", "Playfair Display", serif'
    : '"JetBrains Mono", "SF Mono", monospace';
  const digitWeight = digitFont === 'serif' ? 200 : 250;
  const digitStyle = digitFont === 'serif' ? 'italic' : 'normal';

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'space-between',
      padding: '60px 22px 90px',
      background: '#000',
      color: '#fff',
      width: '100%', boxSizing: 'border-box',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* ambient red glow when warning */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: warning
          ? `radial-gradient(ellipse at 50% 55%, ${hexToRgba(accent, 0.28)} 0%, transparent 62%)`
          : `radial-gradient(ellipse at 50% 100%, ${hexToRgba(accent, 0.06)} 0%, transparent 60%)`,
        transition: 'background 0.4s ease',
        animation: warning ? 'pulseGlow 1s ease-in-out infinite' : 'none',
      }}/>

      {/* logo */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 10, position: 'relative', marginTop: 4,
      }}>
        <img src="assets/mafia-logo.png" alt="Mafia"
          style={{
            width: 200, height: 200, objectFit: 'contain',
            filter: `drop-shadow(0 6px 24px ${hexToRgba(accent, 0.3)})`,
          }}/>
      </div>

      {/* timer ring */}
      <div style={{ position: 'relative', width: ringSize, height: ringSize }}>
        <svg width={ringSize} height={ringSize} style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          {/* track */}
          <circle cx={ringSize/2} cy={ringSize/2} r={r}
            stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} fill="none"/>
          {/* progress */}
          <circle cx={ringSize/2} cy={ringSize/2} r={r}
            stroke={warning ? accent : '#fff'}
            strokeWidth={stroke} fill="none"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
            filter={warning ? 'url(#glow)' : undefined}
            style={{ transition: 'stroke 0.3s' }}/>
        </svg>
        {/* end-cap dot */}
        {pct > 0.001 && pct < 0.999 && (
          <div style={{
            position: 'absolute', left: dotX - 5, top: dotY - 5,
            width: 10, height: 10, borderRadius: '50%',
            background: warning ? accent : '#fff',
            boxShadow: warning ? `0 0 12px ${accent}` : '0 0 8px rgba(255,255,255,0.6)',
          }}/>
        )}
        {/* tick marks at 12/3/6/9 */}
        {[0, 90, 180, 270].map(deg => (
          <div key={deg} style={{
            position: 'absolute', left: '50%', top: '50%',
            width: 1, height: ringSize / 2,
            transform: `translate(-50%, -100%) rotate(${deg}deg)`,
            transformOrigin: 'bottom center',
            pointerEvents: 'none',
          }}>
            <div style={{
              width: 1, height: 6, background: 'rgba(255,255,255,0.18)',
              marginTop: -3,
            }}/>
          </div>
        ))}

        {/* digits */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <div style={{
            fontFamily: digitFontFamily,
            fontSize: 110, fontWeight: digitWeight,
            fontStyle: digitStyle,
            lineHeight: 1,
            color: warning ? accent : '#fff',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: -3,
            transition: 'color 0.3s',
            textShadow: warning ? `0 0 20px ${hexToRgba(accent, 0.5)}` : 'none',
          }}>{String(display).padStart(2, '0')}</div>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 10, letterSpacing: 4, textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.45)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{
              width: 4, height: 4, borderRadius: '50%',
              background: t.duration === FULL ? '#fff' : accent,
            }}/>
            {t.duration}s
          </div>
        </div>
      </div>

      {/* controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: '100%', alignItems: 'center' }}>
        {/* preset row */}
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <PresetBtn duration="60s" active={t.duration === FULL} onClick={() => t.reset(FULL)} accent={accent}/>
          <PresetBtn duration="30s" active={t.duration === HALF} onClick={() => t.reset(HALF)} accent={accent}/>
        </div>
        {/* primary control row */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'center' }}>
          <SecondaryBtn onClick={() => t.reset(t.duration)} disabled={t.remainingMs === t.duration * 1000 && !t.running} ariaLabel="Reset timer">
            <StopIcon size={18}/>
          </SecondaryBtn>
          <PrimaryBtn running={t.running} onClick={() => t.running ? t.pause() : t.start()} accent={accent}/>
          <SecondaryBtn onClick={() => setMuted(m => !m)} ghost={!muted} ariaLabel={muted ? "Unmute" : "Mute"}>
            <SoundIcon muted={muted}/>
          </SecondaryBtn>
        </div>
      </div>
    </div>
  );
}

function PresetBtn({ duration, active, onClick, accent }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, height: 64, borderRadius: 16,
      background: active ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)',
      border: active ? `1px solid ${hexToRgba(accent, 0.5)}` : '1px solid rgba(255,255,255,0.07)',
      color: '#fff', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.2s',
      position: 'relative',
    }}>
      <span style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 20, fontWeight: 400,
        color: active ? accent : 'rgba(255,255,255,0.5)',
        fontVariantNumeric: 'tabular-nums',
      }}>{duration}</span>
      {active && (
        <div style={{
          position: 'absolute', bottom: -1, left: '50%', transform: 'translateX(-50%)',
          width: 24, height: 2, background: accent, borderRadius: 1,
        }}/>
      )}
    </button>
  );
}

function PrimaryBtn({ running, onClick, accent }) {
  return (
    <button onClick={onClick} aria-label={running ? "Pause timer" : "Start timer"}
      onPointerDown={e => e.currentTarget.style.transform='scale(0.94)'}
      onPointerUp={e => e.currentTarget.style.transform='scale(1)'}
      onPointerLeave={e => e.currentTarget.style.transform='scale(1)'}
      style={{
        width: 80, height: 80, borderRadius: '50%',
        background: running ? '#fff' : accent,
        border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: running
          ? '0 8px 24px rgba(255,255,255,0.15), inset 0 1px 0 rgba(255,255,255,0.5)'
          : `0 8px 28px ${hexToRgba(accent, 0.5)}, inset 0 1px 0 rgba(255,255,255,0.25)`,
        transition: 'transform 0.12s, background 0.25s, box-shadow 0.25s',
      }}>
      {running ? <PauseIcon size={30} color="#000"/> : <PlayIcon size={30}/>}
    </button>
  );
}

function SecondaryBtn({ children, onClick, disabled, ghost, ariaLabel }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={ariaLabel} style={{
      width: 52, height: 52, borderRadius: '50%',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      color: ghost ? 'rgba(255,255,255,0.5)' : '#fff',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.3 : 1,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.2s',
    }}>{children}</button>
  );
}

const SoundIcon = ({ muted }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M3 7v6h3l5 4V3L6 7H3z" fill="currentColor"/>
    {!muted && <path d="M14 6c1.5 1 1.5 7 0 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/>}
    {muted && <path d="M14 7l5 6M19 7l-5 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>}
  </svg>
);

function hexToRgba(hex, a) {
  const h = hex.replace('#','');
  const r = parseInt(h.substring(0,2),16);
  const g = parseInt(h.substring(2,4),16);
  const b = parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

Object.assign(window, { VariantClassic });
