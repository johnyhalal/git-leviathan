import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config
// `env.root` is the project root injected by Electron Forge's Vite plugin.
// We serve/build this window from its own folder but emit into the project
// `.vite/renderer/main_window` so the main process can load it and Forge can
// package it (Vite resolves a relative `outDir` against `root`, hence absolute).
export default defineConfig((env) => ({
  root: resolve(env.root, 'src/renderer/main'),
  build: {
    outDir: resolve(env.root, '.vite/renderer/main_window'),
    emptyOutDir: true,
  },
  plugins: [react()],
}));
