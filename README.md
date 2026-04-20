# Mafia Timer

A single-page speech timer for the Mafia party game. Two presets — **60-second speech** and **30-second last word** — with an audible 10-second warning and a pulsing red ring as time runs out.

Runs entirely in the browser, installable as a PWA.

## Use

Open `index.html` (or a deployed URL) on a phone or tablet:

- **Speech / Last Word** — pick the preset.
- **Play** — start / pause.
- **Square** — reset to the current preset.
- **Speaker** — mute or unmute the start and warning cues.

## Layout

```
index.html        self-unpacking bundle (see "Bundle" below)
manifest.json     PWA manifest
assets/
  mafia-logo.png  rendered above the ring
  sound_start.mp3 played on Start
  sound_10sec.mp3 played when 10 seconds remain
  favicon.ico
robots.txt
scripts/
  bundle.py       extract / inject the app source in index.html
```

## Bundle

`index.html` is a single self-contained file. Its outer shell decodes a
base64+gzipped manifest on load and replaces `document.documentElement` with
the packed template. The manifest holds:

- **React 18 + ReactDOM + Babel Standalone** (exposed to the template as blob URLs).
- **The app JSX** (inline, transformed by Babel at load time).
- **Font faces** (Fraunces, JetBrains Mono).

Files under `assets/` and `manifest.json` are **not** packed into the blob;
they must be served alongside `index.html` so the runtime `<img src="assets/…">`
and `new Audio('assets/…')` calls resolve.

### Editing the app

The app source lives inside `index.html` as a gzipped blob, so direct text
edits aren't practical. Use `scripts/bundle.py`:

```bash
python3 scripts/bundle.py extract index.html
# edit /tmp/bundle/app.jsx and/or /tmp/bundle/template.html
python3 scripts/bundle.py inject  index.html
python3 scripts/bundle.py verify  index.html
```

`verify` round-trips extract → inject → extract and asserts the decoded
sources are byte-identical (gzip output itself is not bit-stable, but the
decoded contents must match).

## Deploy

Serve the repo root. All paths are relative, so any static host (GitHub
Pages, Netlify, an S3 bucket, `python3 -m http.server`) works with no build
step. Serving over HTTPS is required for PWA install.

## License

MIT — see [LICENSE](LICENSE).
