import type { ExposedApi } from './ipc';

declare global {
  interface Window {
    api: ExposedApi;
  }
}

export {};
