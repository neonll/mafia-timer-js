# Mafia Timer

A single-screen speech timer for the Mafia party game. Two presets — **60 s** speech and
**30 s** last word — with a start cue, a 10-second audio countdown that ends exactly at zero,
and a pulsing red ring as time runs out. Installable as an offline PWA; the screen stays awake
while the timer runs.

## Use

- **60s / 30s** — pick the preset (resets the timer).
- **Play / Pause** — start, pause, resume. `Space` does the same on a keyboard.
- **Square** — reset to the current preset.
- **Speaker** — mute or unmute the cues (remembered on this device).

## Develop

Requires Node 22+.

```bash
npm i
npm run dev          # Vite dev server
npm test             # Vitest: timer core, cue scheduling, hook and UI tests
npm run lint         # ESLint (typescript-eslint strict, react-hooks)
npm run typecheck    # tsc, strict
npm run build        # type-check + production build into dist/ (with the service worker)
npm run preview      # serve dist/ locally
```

`npm run icons` regenerates the PWA icons in `public/icons/` from `src/assets/mafia-logo.png`
(run it after changing the logo and commit the output).

## Deploy (Cloudflare Workers, static assets)

`wrangler.jsonc` serves `dist/` as static assets with single-page-application fallback; there
is no Worker script.

```bash
npx wrangler login   # once per machine
npm run deploy       # vite build && wrangler deploy
```

Alternatively connect the GitHub repo to Cloudflare Workers Builds with build command
`npm run build` and deploy command `npx wrangler deploy`.

## How it works

- `src/core/timer.ts` is a pure state machine (`idle → running ⇄ paused → finished`) over an
  injected clock. The UI never counts ticks: it asks the core how much time is left at
  `performance.now()`, so background tabs, throttled frames and pauses cannot drift.
- `src/audio/cues.ts` plays the cues with Web Audio. Both files are decoded at load; the
  AudioContext is created inside the first Play tap. The warning file is a 10-second countdown,
  so it is scheduled to start 10 s before the timer's end (or started mid-file when less is
  left) and stopped on pause or reset. Mute is a gain node.
- `src/hooks/useTimer.ts` ties it together: a `requestAnimationFrame` loop while running and
  visible, a resync on `visibilitychange`, and a screen wake lock while running.

## Layout

```
index.html              Vite entry (meta tags, icons)
public/
  sounds/start.mp3      start cue
  sounds/warning-10s.mp3  10-second countdown cue
  icons/                PWA + apple-touch icons (generated, committed)
  favicon.ico
  robots.txt
src/
  main.tsx              entry: creates the cue engine, renders <App>
  assets/mafia-logo.png
  core/timer.ts         pure timer state machine (+ tests)
  audio/cues.ts         Web Audio cues, mute persistence (+ tests)
  hooks/useTimer.ts     core + rAF + visibility + cues + wake lock (+ tests)
  hooks/useWakeLock.ts
  ui/App.tsx            the screen (+ tests)
  ui/Ring.tsx           progress ring and digits
  ui/Controls.tsx       presets, play/pause, reset, mute
  ui/icons.tsx
  ui/styles.css
scripts/icons.mjs       icon generator (sharp)
vite.config.ts          Vite, Vitest and PWA (manifest, precache) config
wrangler.jsonc          Cloudflare Workers static-assets config
```

## License

MIT — see [LICENSE](LICENSE).
