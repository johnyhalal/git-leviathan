import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './app.css';

// Dev-only boot instrumentation: these logs are forwarded to the main process'
// boot-debug.log via the webContents 'console-message' hook, to diagnose the
// intermittent blank window on startup. `import.meta.env.DEV` is a Vite
// compile-time constant, so this whole block is stripped from production builds.
if (import.meta.env.DEV) {
  window.addEventListener('error', (event) =>
    console.error('[renderer] window error', event.message, event.filename, event.lineno),
  );
  window.addEventListener('unhandledrejection', (event) =>
    console.error('[renderer] unhandledrejection', String(event.reason)),
  );
}

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
  requestAnimationFrame(() => {
    window.api.app.signalReady();
  }),
);
