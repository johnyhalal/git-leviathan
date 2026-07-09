import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config
// See vite.renderer.main.config.ts for why `outDir` is an absolute path.
export default defineConfig((env) => ({
  root: resolve(env.root, 'src/renderer/splash'),
  // Own dep-optimizer cache — see vite.renderer.main.config.ts for why sharing
  // the default `node_modules/.vite` between the two renderers races and can
  // blank the main window.
  cacheDir: resolve(env.root, 'node_modules/.vite/splash_window'),
  build: {
    outDir: resolve(env.root, '.vite/renderer/splash_window'),
    emptyOutDir: true,
  },
  plugins: [react()],
}));
