import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config
// See vite.renderer.main.config.ts for why `outDir` is an absolute path.
export default defineConfig((env) => ({
  root: resolve(env.root, 'src/renderer/splash'),
  build: {
    outDir: resolve(env.root, '.vite/renderer/splash_window'),
    emptyOutDir: true,
  },
  plugins: [react()],
}));
