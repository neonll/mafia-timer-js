# Mafia Timer

A single-screen speech timer for the Mafia party game. Two presets — **60 s** speech and
**30 s** last word — with a start cue, a 10-second audio countdown that ends exactly at zero,
and a pulsing red ring as time runs out. Installable as an offline PWA; the screen stays awake
while the timer runs.

## Use

- **60s / 30s** — pick the preset (resets the timer).
- **Play / Pause** — start, pause, resume. Tapping the ring does the same, and so does `Space`
  on a keyboard.
- **Square** — reset to the current preset.
- **Speaker** — mute or unmute the cues (remembered on this device).

While paused the ring dims and reads PAUSED; when time is up it stays full and red and reads
TIME'S UP until you reset or start again (with the buttons: tapping the ring does nothing then, so
an accidental tap can't restart the timer). On Android the phone also vibrates briefly when the
last ten seconds start and twice when time is up (regardless of mute; iPhones have no
vibration API for web pages).

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
- `src/audio/cues.ts` plays the cues on plain `<audio>` elements, unlocked on the first Play
  tap. The warning file is a 10-second countdown that ends exactly at zero: it is driven by the
  timer clock (a timeout starts it 10 s before the end, or mid-file when less is left) and
  checked every frame while it plays. Only a real stall (more than 1 s off, e.g. after the page
  was hidden) is seeked back, at most once every 3 s, because each seek is an audible skip; the
  small, constant play-start latency is left alone. Pause pauses it, reset rewinds it; mute mutes both elements.
- `src/hooks/useTimer.ts` ties it together: a `requestAnimationFrame` loop while running and
  visible, a resync on `visibilitychange`, and a screen wake lock while running.
- The service worker updates in the background and never reloads the page; a new version is
  picked up on the next launch.

## Troubleshooting

- Audio out of sync or missing on a phone: open the app with `?debug` (or `#debug`) in the URL to
  show a small overlay with each audio element's state, the warning's expected position and
  drift, how many corrective seeks happened this run, the timer's remaining time, and the last
  cue warnings.

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
  audio/cues.ts         <audio> cues, mute persistence (+ tests)
  hooks/useTimer.ts     core + rAF + visibility + cues + wake lock (+ tests)
  hooks/useWakeLock.ts
  ui/App.tsx            the screen (+ tests)
  ui/Ring.tsx           progress ring and digits
  ui/Controls.tsx       presets, play/pause, reset, mute
  ui/DebugOverlay.tsx   ?debug audio diagnostics (lazy-loaded)
  ui/icons.tsx
  ui/styles.css
scripts/icons.mjs       icon generator (sharp)
vite.config.ts          Vite, Vitest and PWA (manifest, precache) config
wrangler.jsonc          Cloudflare Workers static-assets config
```

## License

MIT — see [LICENSE](LICENSE).
