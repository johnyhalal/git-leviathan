/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

// The Vite plugin generates one pair of magic constants per named renderer.
// `main_window`'s constants come from the reference above; declare the splash's.
declare const SPLASH_WINDOW_VITE_DEV_SERVER_URL: string;
declare const SPLASH_WINDOW_VITE_NAME: string;

// Baked into the main bundle from `.env` by vite.main.config.ts. Public
// device-flow client ids; empty string when unset.
declare const __GITHUB_CLIENT_ID__: string;
declare const __GITLAB_CLIENT_ID__: string;
