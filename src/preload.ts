import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  AppChannels,
  IntegrationChannels,
  RepoChannels,
  ThemeChannels,
  type CheckoutResult,
  type RefsMutationResult,
  type GitflowKind,
  type CloneProgress,
  type CloneRequest,
  type CloneResult,
  type CommitLogEntry,
  type CommitResult,
  type DeviceCodePrompt,
  type ExposedApi,
  type FileChange,
  type WorkingStatus,
  type IntegrationProvider,
  type IntegrationsState,
  type OpenRepoResult,
  type RecentRepo,
  type RemoteRepo,
  type RepoInfo,
  type RepoRefs,
  type ThemeSource,
  type ThemeState,
} from './types/ipc';

const api: ExposedApi = {
  platform: process.platform,
  app: {
    signalReady: () => ipcRenderer.send(AppChannels.ready),
    getSidebarSections: () =>
      ipcRenderer.invoke(AppChannels.getSidebarSections) as Promise<
        Record<string, boolean>
      >,
    setSidebarSection: (key: string, open: boolean) =>
      ipcRenderer.invoke(AppChannels.setSidebarSection, key, open) as Promise<void>,
  },
  repo: {
    open: () => ipcRenderer.invoke(RepoChannels.open) as Promise<OpenRepoResult>,
    listRefs: (path: string) =>
      ipcRenderer.invoke(RepoChannels.listRefs, path) as Promise<RepoRefs>,
    log: (path: string, limit?: number) =>
      ipcRenderer.invoke(RepoChannels.log, path, limit) as Promise<CommitLogEntry[]>,
    commitFiles: (path: string, hash: string) =>
      ipcRenderer.invoke(RepoChannels.commitFiles, path, hash) as Promise<FileChange[]>,
    status: (path: string) =>
      ipcRenderer.invoke(RepoChannels.status, path) as Promise<WorkingStatus>,
    stage: (path: string, file: string | null) =>
      ipcRenderer.invoke(RepoChannels.stage, path, file) as Promise<WorkingStatus>,
    unstage: (path: string, file: string | null) =>
      ipcRenderer.invoke(RepoChannels.unstage, path, file) as Promise<WorkingStatus>,
    commit: (path: string, message: string) =>
      ipcRenderer.invoke(RepoChannels.commit, path, message) as Promise<CommitResult>,
    checkout: (path: string, branch: string, remote?: string) =>
      ipcRenderer.invoke(RepoChannels.checkout, path, branch, remote) as Promise<CheckoutResult>,
    stashPop: (path: string, index: number) =>
      ipcRenderer.invoke(RepoChannels.stashPop, path, index) as Promise<RefsMutationResult>,
    stashDrop: (path: string, index: number) =>
      ipcRenderer.invoke(RepoChannels.stashDrop, path, index) as Promise<RefsMutationResult>,
    gitflowStart: (path: string, kind: GitflowKind, name: string) =>
      ipcRenderer.invoke(RepoChannels.gitflowStart, path, kind, name) as Promise<RefsMutationResult>,
    gitflowFinish: (path: string) =>
      ipcRenderer.invoke(RepoChannels.gitflowFinish, path) as Promise<RefsMutationResult>,
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
    openTabs: () =>
      ipcRenderer.invoke(RepoChannels.openTabs) as Promise<string[]>,
    saveOpenTabs: (paths: string[]) =>
      ipcRenderer.invoke(RepoChannels.saveOpenTabs, paths) as Promise<void>,
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
