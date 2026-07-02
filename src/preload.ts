import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  AppChannels,
  RepoChannels,
  ThemeChannels,
  type ExposedApi,
  type OpenRepoResult,
  type ThemeSource,
  type ThemeState,
} from './types/ipc';

const api: ExposedApi = {
  platform: process.platform,
  app: {
    signalReady: () => ipcRenderer.send(AppChannels.ready),
  },
  repo: {
    open: () => ipcRenderer.invoke(RepoChannels.open) as Promise<OpenRepoResult>,
  },
  theme: {
    get: () => ipcRenderer.invoke(ThemeChannels.get) as Promise<ThemeState>,
    set: (source: ThemeSource) =>
      ipcRenderer.invoke(ThemeChannels.set, source) as Promise<ThemeState>,
    onChange: (callback) => {
      const listener = (_event: IpcRendererEvent, state: ThemeState) =>
        callback(state);
      ipcRenderer.on(ThemeChannels.changed, listener);
      return () => ipcRenderer.removeListener(ThemeChannels.changed, listener);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);
