// Shared contract between the main process, preload bridge and renderers.
// Keep this file dependency-free so it can be imported from every context.

export type ThemeSource = 'system' | 'light' | 'dark';

export interface ThemeState {
  /** The user's explicit preference. */
  source: ThemeSource;
  /** Whether the effective (resolved) theme is currently dark. */
  shouldUseDarkColors: boolean;
}

export const ThemeChannels = {
  /** Renderer -> main (invoke): read the current theme state. */
  get: 'theme:get',
  /** Renderer -> main (invoke): change the preference, returns new state. */
  set: 'theme:set',
  /** Main -> renderer (send): the effective theme changed. */
  changed: 'theme:changed',
} as const;

export const AppChannels = {
  /**
   * Renderer -> main (send): the React app has mounted and painted a frame.
   * The main process waits for this before revealing the main window, so a
   * slow or reloading dev server can never surface a blank window.
   */
  ready: 'app:ready',
} as const;

// ---- Bridge surface exposed on `window.api` (see preload.ts) --------------

export interface ThemeApi {
  get(): Promise<ThemeState>;
  set(source: ThemeSource): Promise<ThemeState>;
  /** Subscribe to theme changes. Returns an unsubscribe function. */
  onChange(callback: (state: ThemeState) => void): () => void;
}

export interface AppApi {
  /**
   * Tell the main process the UI has mounted and painted, so it can reveal the
   * main window and dismiss the splash. Safe to call once per load.
   */
  signalReady(): void;
}

export interface ExposedApi {
  /** Host OS platform, mirrored from the main process' `process.platform`. */
  platform: NodeJS.Platform;
  theme: ThemeApi;
  app: AppApi;
}
