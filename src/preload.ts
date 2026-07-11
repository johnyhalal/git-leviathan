import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  AppChannels,
  ClaudeChannels,
  IntegrationChannels,
  RepoChannels,
  ThemeChannels,
  UpdateChannels,
  type ClaudeStatus,
  type GenerateCommitResult,
  type CheckoutResult,
  type RefsMutationResult,
  type UndoRedoState,
  type GitflowKind,
  type CloneProgress,
  type RepoActivityEvent,
  type CloneRequest,
  type CloneResult,
  type CommitLogEntry,
  type CommitDetailData,
  type CommitResult,
  type DeviceCodePrompt,
  type DiffSource,
  type ExposedApi,
  type FileChange,
  type FileDiff,
  type WorkingStatus,
  type MergeState,
  type ConflictFileContent,
  type MergeResolution,
  type IntegrationProvider,
  type IntegrationsState,
  type OpenRepoResult,
  type OpenTabsState,
  type PullMode,
  type PushResult,
  type RecentRepo,
  type RemoteRepo,
  type RepoInfo,
  type RepoRefs,
  type SshKeyInfo,
  type ThemeSource,
  type ThemeState,
  type UpdateInfo,
  type UpdateStatus,
} from './types/ipc';

// The main process passes the app version via webPreferences.additionalArguments
// as `--app-version=x`; pull it back off argv for a synchronous read.
const appVersion =
  process.argv.find((arg) => arg.startsWith('--app-version='))?.slice('--app-version='.length) ?? '';

const api: ExposedApi = {
  platform: process.platform,
  version: appVersion,
  app: {
    signalReady: () => ipcRenderer.send(AppChannels.ready),
    getSidebarSections: () =>
      ipcRenderer.invoke(AppChannels.getSidebarSections) as Promise<
        Record<string, boolean>
      >,
    setSidebarSection: (key: string, open: boolean) =>
      ipcRenderer.invoke(AppChannels.setSidebarSection, key, open) as Promise<void>,
    getPullMode: () =>
      ipcRenderer.invoke(AppChannels.getPullMode) as Promise<PullMode>,
    setPullMode: (mode: PullMode) =>
      ipcRenderer.invoke(AppChannels.setPullMode, mode) as Promise<void>,
    onWindowFocus: (callback) => {
      const listener = () => callback();
      ipcRenderer.on(AppChannels.focused, listener);
      return () => ipcRenderer.removeListener(AppChannels.focused, listener);
    },
  },
  repo: {
    open: () => ipcRenderer.invoke(RepoChannels.open) as Promise<OpenRepoResult>,
    listRefs: (path: string) =>
      ipcRenderer.invoke(RepoChannels.listRefs, path) as Promise<RepoRefs>,
    log: (path: string, limit?: number) =>
      ipcRenderer.invoke(RepoChannels.log, path, limit) as Promise<CommitLogEntry[]>,
    commitFiles: (path: string, hash: string) =>
      ipcRenderer.invoke(RepoChannels.commitFiles, path, hash) as Promise<FileChange[]>,
    commitTree: (path: string, hash: string) =>
      ipcRenderer.invoke(RepoChannels.commitTree, path, hash) as Promise<string[]>,
    fileDiff: (path: string, source: DiffSource, file: string) =>
      ipcRenderer.invoke(RepoChannels.fileDiff, path, source, file) as Promise<FileDiff>,
    fileContent: (path: string, source: DiffSource, file: string) =>
      ipcRenderer.invoke(RepoChannels.fileContent, path, source, file) as Promise<string[]>,
    commitDetail: (path: string, hash: string) =>
      ipcRenderer.invoke(RepoChannels.commitDetail, path, hash) as Promise<CommitDetailData>,
    status: (path: string) =>
      ipcRenderer.invoke(RepoChannels.status, path) as Promise<WorkingStatus>,
    stage: (path: string, file: string | null) =>
      ipcRenderer.invoke(RepoChannels.stage, path, file) as Promise<WorkingStatus>,
    unstage: (path: string, file: string | null) =>
      ipcRenderer.invoke(RepoChannels.unstage, path, file) as Promise<WorkingStatus>,
    discardAll: (path: string) =>
      ipcRenderer.invoke(RepoChannels.discardAll, path) as Promise<WorkingStatus>,
    commit: (path: string, message: string, amend?: boolean) =>
      ipcRenderer.invoke(RepoChannels.commit, path, message, amend) as Promise<CommitResult>,
    headMessage: (path: string) =>
      ipcRenderer.invoke(RepoChannels.headMessage, path) as Promise<string>,
    reword: (path: string, hash: string, message: string) =>
      ipcRenderer.invoke(RepoChannels.reword, path, hash, message) as Promise<CommitResult>,
    rewordCount: (path: string, hash: string) =>
      ipcRenderer.invoke(RepoChannels.rewordCount, path, hash) as Promise<number>,
    undoState: (path: string) =>
      ipcRenderer.invoke(RepoChannels.undoState, path) as Promise<UndoRedoState>,
    undo: (path: string) =>
      ipcRenderer.invoke(RepoChannels.undo, path) as Promise<RefsMutationResult>,
    redo: (path: string) =>
      ipcRenderer.invoke(RepoChannels.redo, path) as Promise<RefsMutationResult>,
    push: (path: string, force?: boolean) =>
      ipcRenderer.invoke(RepoChannels.push, path, force) as Promise<PushResult>,
    pushSetUpstream: (path: string, remote: string, branch: string, remoteBranch?: string) =>
      ipcRenderer.invoke(
        RepoChannels.pushSetUpstream,
        path,
        remote,
        branch,
        remoteBranch,
      ) as Promise<CommitResult>,
    pull: (path: string, mode: PullMode) =>
      ipcRenderer.invoke(RepoChannels.pull, path, mode) as Promise<CommitResult>,
    checkout: (path: string, branch: string, remote?: string) =>
      ipcRenderer.invoke(RepoChannels.checkout, path, branch, remote) as Promise<CheckoutResult>,
    createBranch: (path: string, name: string) =>
      ipcRenderer.invoke(RepoChannels.createBranch, path, name) as Promise<RefsMutationResult>,
    deleteBranch: (path: string, branch: string) =>
      ipcRenderer.invoke(RepoChannels.deleteBranch, path, branch) as Promise<RefsMutationResult>,
    deleteRemoteBranch: (path: string, remote: string, branch: string) =>
      ipcRenderer.invoke(
        RepoChannels.deleteRemoteBranch,
        path,
        remote,
        branch,
      ) as Promise<RefsMutationResult>,
    merge: (path: string, source: string, target: string) =>
      ipcRenderer.invoke(RepoChannels.merge, path, source, target) as Promise<RefsMutationResult>,
    rebase: (path: string, source: string, target: string) =>
      ipcRenderer.invoke(RepoChannels.rebase, path, source, target) as Promise<RefsMutationResult>,
    stashPush: (path: string) =>
      ipcRenderer.invoke(RepoChannels.stashPush, path) as Promise<RefsMutationResult>,
    stashPop: (path: string, index: number) =>
      ipcRenderer.invoke(RepoChannels.stashPop, path, index) as Promise<RefsMutationResult>,
    stashDrop: (path: string, index: number) =>
      ipcRenderer.invoke(RepoChannels.stashDrop, path, index) as Promise<RefsMutationResult>,
    gitflowStart: (path: string, kind: GitflowKind, name: string) =>
      ipcRenderer.invoke(RepoChannels.gitflowStart, path, kind, name) as Promise<RefsMutationResult>,
    gitflowFinish: (path: string) =>
      ipcRenderer.invoke(RepoChannels.gitflowFinish, path) as Promise<RefsMutationResult>,
    mergeState: (path: string) =>
      ipcRenderer.invoke(RepoChannels.mergeState, path) as Promise<MergeState | null>,
    conflictFile: (path: string, file: string) =>
      ipcRenderer.invoke(RepoChannels.conflictFile, path, file) as Promise<ConflictFileContent>,
    resolveFile: (path: string, file: string, resolution: MergeResolution) =>
      ipcRenderer.invoke(
        RepoChannels.resolveFile,
        path,
        file,
        resolution,
      ) as Promise<MergeState | null>,
    mergeContinue: (path: string) =>
      ipcRenderer.invoke(RepoChannels.mergeContinue, path) as Promise<RefsMutationResult>,
    mergeAbort: (path: string) =>
      ipcRenderer.invoke(RepoChannels.mergeAbort, path) as Promise<RefsMutationResult>,
    rebaseSkip: (path: string) =>
      ipcRenderer.invoke(RepoChannels.rebaseSkip, path) as Promise<RefsMutationResult>,
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
      ipcRenderer.invoke(RepoChannels.openTabs) as Promise<OpenTabsState>,
    saveOpenTabs: (paths: string[], activePath: string | null) =>
      ipcRenderer.invoke(RepoChannels.saveOpenTabs, paths, activePath) as Promise<void>,
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
    watch: (path: string | null) => ipcRenderer.send(RepoChannels.watch, path),
    onRepoChanged: (callback) => {
      const listener = (_event: IpcRendererEvent, path: string) => callback(path);
      ipcRenderer.on(RepoChannels.changed, listener);
      return () => ipcRenderer.removeListener(RepoChannels.changed, listener);
    },
    onActivity: (callback) => {
      const listener = (_event: IpcRendererEvent, activity: RepoActivityEvent) =>
        callback(activity);
      ipcRenderer.on(RepoChannels.activity, listener);
      return () => ipcRenderer.removeListener(RepoChannels.activity, listener);
    },
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
    sshKeys: (provider: IntegrationProvider) =>
      ipcRenderer.invoke(
        IntegrationChannels.sshKeys,
        provider,
      ) as Promise<SshKeyInfo[]>,
    addSshKey: (provider: IntegrationProvider) =>
      ipcRenderer.invoke(
        IntegrationChannels.addSshKey,
        provider,
      ) as Promise<SshKeyInfo>,
    removeSshKey: (provider: IntegrationProvider) =>
      ipcRenderer.invoke(
        IntegrationChannels.removeSshKey,
        provider,
      ) as Promise<SshKeyInfo[]>,
    onChange: (callback) => {
      const listener = (_event: IpcRendererEvent, state: IntegrationsState) =>
        callback(state);
      ipcRenderer.on(IntegrationChannels.changed, listener);
      return () =>
        ipcRenderer.removeListener(IntegrationChannels.changed, listener);
    },
  },
  claude: {
    status: () => ipcRenderer.invoke(ClaudeChannels.status) as Promise<ClaudeStatus>,
    connect: () => ipcRenderer.invoke(ClaudeChannels.connect) as Promise<ClaudeStatus>,
    disconnect: () =>
      ipcRenderer.invoke(ClaudeChannels.disconnect) as Promise<ClaudeStatus>,
    generateCommitMessage: (path: string) =>
      ipcRenderer.invoke(
        ClaudeChannels.generateCommitMessage,
        path,
      ) as Promise<GenerateCommitResult>,
  },
  update: {
    check: () =>
      ipcRenderer.invoke(UpdateChannels.check) as Promise<UpdateInfo | null>,
    openRelease: (url: string) =>
      ipcRenderer.send(UpdateChannels.openRelease, url),
    download: () => ipcRenderer.send(UpdateChannels.download),
    install: () => ipcRenderer.send(UpdateChannels.install),
    onStatus: (callback: (status: UpdateStatus) => void) => {
      const listener = (_event: IpcRendererEvent, status: UpdateStatus) =>
        callback(status);
      ipcRenderer.on(UpdateChannels.statusChanged, listener);
      // Prime the caller with the current snapshot right away.
      void (ipcRenderer.invoke(UpdateChannels.status) as Promise<UpdateStatus>).then(
        callback,
      );
      return () => {
        ipcRenderer.removeListener(UpdateChannels.statusChanged, listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('api', api);
