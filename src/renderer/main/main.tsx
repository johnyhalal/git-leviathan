import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root was not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Tell the main process to reveal the window only after we've painted a frame,
// so a slow or reloading dev server never surfaces a blank window.
requestAnimationFrame(() =>
  requestAnimationFrame(() => window.api.app.signalReady()),
);
