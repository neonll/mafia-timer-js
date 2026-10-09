import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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
