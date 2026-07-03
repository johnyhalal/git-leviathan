import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  AppChannels,
  IntegrationChannels,
  RepoChannels,
  ThemeChannels,
  type CloneProgress,
  type CloneRequest,
  type CloneResult,
  type DeviceCodePrompt,
  type ExposedApi,
  type IntegrationProvider,
  type IntegrationsState,
  type OpenRepoResult,
  type RecentRepo,
  type RemoteRepo,
  type RepoInfo,
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
    chooseDirectory: () =>
      ipcRenderer.invoke(RepoChannels.chooseDir) as Promise<string | null>,
    lastCloneDirectory: () =>
      ipcRenderer.invoke(RepoChannels.lastCloneDir) as Promise<string | null>,
    recent: () =>
      ipcRenderer.invoke(RepoChannels.recent) as Promise<RecentRepo[]>,
    recordOpened: (repo: RepoInfo) =>
      ipcRenderer.invoke(RepoChannels.record, repo) as Promise<RecentRepo[]>,
    forget: (path: string) =>
      ipcRenderer.invoke(RepoChannels.forget, path) as Promise<RecentRepo[]>,
    clone: (request: CloneRequest) =>
      ipcRenderer.invoke(RepoChannels.clone, request) as Promise<CloneResult>,
    onCloneProgress: (callback) => {
      const listener = (_event: IpcRendererEvent, progress: CloneProgress) =>
        callback(progress);
      ipcRenderer.on(RepoChannels.cloneProgress, listener);
      return () =>
        ipcRenderer.removeListener(RepoChannels.cloneProgress, listener);
    },
    cancelClone: () =>
      ipcRenderer.invoke(RepoChannels.cloneCancel) as Promise<void>,
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
  integrations: {
    list: () =>
      ipcRenderer.invoke(IntegrationChannels.list) as Promise<IntegrationsState>,
    connect: (provider: IntegrationProvider) =>
      ipcRenderer.invoke(
        IntegrationChannels.connect,
        provider,
      ) as Promise<DeviceCodePrompt>,
    disconnect: (provider: IntegrationProvider) =>
      ipcRenderer.invoke(
        IntegrationChannels.disconnect,
        provider,
      ) as Promise<IntegrationsState>,
    repositories: (provider: IntegrationProvider) =>
      ipcRenderer.invoke(
        IntegrationChannels.repositories,
        provider,
      ) as Promise<RemoteRepo[]>,
    onChange: (callback) => {
      const listener = (_event: IpcRendererEvent, state: IntegrationsState) =>
        callback(state);
      ipcRenderer.on(IntegrationChannels.changed, listener);
      return () =>
        ipcRenderer.removeListener(IntegrationChannels.changed, listener);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);
