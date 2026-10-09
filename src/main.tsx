import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './ui/styles.css';
import { createCues, readStoredMute } from './audio/cues';
import { App } from './ui/App';

// One cue engine for the app's lifetime: starts fetching/decoding immediately.
const cues = createCues({ muted: readStoredMute() });

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <App cues={cues} />
  </StrictMode>,
);

// Service worker: a new version installs and takes over in the background, but
// the page is never reloaded under a running timer; the next launch picks it up.
registerSW({
  immediate: true,
  onNeedReload() {
    // Intentionally no reload (the default in autoUpdate mode).
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => undefined);
    });
  },
});
