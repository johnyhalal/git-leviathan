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

// ---- Repositories ---------------------------------------------------------

export interface RepoInfo {
  /** Repository folder name (basename of the path), shown as the tab title. */
  name: string;
  /** Absolute path to the repository root on disk. */
  path: string;
}

/** A repository in the persisted "recent" list. */
export interface RecentRepo extends RepoInfo {
  /** Epoch milliseconds of the last time this repo was opened. */
  lastOpenedAt: number;
}

/** Outcome of the native "open repository" folder picker. */
export type OpenRepoResult =
  | { status: 'opened'; repo: RepoInfo }
  | { status: 'canceled' }
  | { status: 'not-a-repo'; path: string };

/** A request to clone a repository into a chosen parent folder. */
export interface CloneRequest {
  /** Repository URL (HTTPS or SSH). */
  url: string;
  /** Parent folder; the repo is cloned into a new subfolder inside it. */
  destination: string;
  /**
   * Name of the subfolder to create inside `destination`. When empty, the main
   * process falls back to the repo name derived from the URL.
   */
  directory?: string;
}

/** A single progress update emitted while a clone runs. */
export interface CloneProgress {
  /** Human-readable phase line, e.g. "Receiving objects: 42% (123/456)". */
  phase: string;
  /** Completion 0–100 when git reports it; undefined means indeterminate. */
  percent?: number;
}

/** Outcome of a clone. */
export type CloneResult =
  | { status: 'cloned'; repo: RepoInfo }
  | { status: 'canceled' }
  | { status: 'error'; message: string };

export const RepoChannels = {
  /** Renderer -> main (invoke): pick a folder and open it as a repository. */
  open: 'repo:open',
  /** Renderer -> main (invoke): pick a destination folder; returns path or null. */
  chooseDir: 'repo:choose-dir',
  /** Renderer -> main (invoke): read the last-used clone destination, if any. */
  lastCloneDir: 'repo:last-clone-dir',
  /** Renderer -> main (invoke): read the persisted recent repositories. */
  recent: 'repo:recent',
  /** Renderer -> main (invoke): record a repo as just opened; returns list. */
  record: 'repo:record',
  /** Renderer -> main (invoke): drop a repo from the recent list; returns it. */
  forget: 'repo:forget',
  /** Renderer -> main (invoke): clone a repository; resolves with the outcome. */
  clone: 'repo:clone',
  /** Main -> renderer (send): a progress update for the in-flight clone. */
  cloneProgress: 'repo:clone-progress',
  /** Renderer -> main (invoke): cancel this window's in-flight clone. */
  cloneCancel: 'repo:clone-cancel',
} as const;

// ---- Integrations ---------------------------------------------------------

/** External Git hosts the app can connect an account to. */
export type IntegrationProvider = 'github' | 'gitlab';

/**
 * Where a provider is in the connect lifecycle:
 * - `disconnected` — no account linked.
 * - `connecting` — a device-authorization flow is in progress (see the
 *   `DeviceCodePrompt` returned by `connect`).
 * - `connected` — an account is linked and a token is stored.
 */
export type IntegrationStatus = 'disconnected' | 'connecting' | 'connected';

/** Connection state for a single provider. */
export interface IntegrationConnection {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  /** The connected account's handle, once known (status `connected`). */
  account?: string;
  /** Transient message from the most recent failed connect attempt. */
  error?: string;
}

/** Connection state for every supported provider, keyed by provider id. */
export type IntegrationsState = Record<
  IntegrationProvider,
  IntegrationConnection
>;

/**
 * Instructions the user must follow to authorize a device flow: open
 * `verificationUri` (the app also opens it automatically) and enter `userCode`.
 * Returned by `connect`; the app then polls in the background and broadcasts a
 * state change when the flow resolves.
 */
export interface DeviceCodePrompt {
  provider: IntegrationProvider;
  userCode: string;
  verificationUri: string;
  /** Seconds until the code expires. */
  expiresIn: number;
}

/** A repository fetched from a connected host, offered for cloning. */
export interface RemoteRepo {
  /** Owner-qualified name, e.g. "octocat/hello-world". */
  fullName: string;
  /** Bare repository name. */
  name: string;
  /** HTTPS clone URL. */
  cloneUrl: string;
  /** Whether the repository is private. */
  private: boolean;
  /** Short description, when the host provides one. */
  description?: string;
  /** ISO timestamp of the last update, for display/sorting. */
  updatedAt?: string;
}

export const IntegrationChannels = {
  /** Renderer -> main (invoke): read connection state for every provider. */
  list: 'integrations:list',
  /** Renderer -> main (invoke): begin a device flow; returns the user prompt. */
  connect: 'integrations:connect',
  /** Renderer -> main (invoke): disconnect (or cancel) a provider; returns state. */
  disconnect: 'integrations:disconnect',
  /** Renderer -> main (invoke): list the connected account's repositories. */
  repositories: 'integrations:repositories',
  /** Main -> renderer (send): connection state changed (e.g. auth completed). */
  changed: 'integrations:changed',
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

export interface RepoApi {
  /**
   * Show the native folder picker and open the chosen directory as a git
   * repository. Resolves with the outcome (opened / canceled / not-a-repo).
   */
  open(): Promise<OpenRepoResult>;
  /**
   * Show the native folder picker to choose a destination directory (e.g. where
   * to clone into). Resolves with the chosen absolute path, or null if canceled.
   */
  chooseDirectory(): Promise<string | null>;
  /**
   * The last-used clone destination (persisted in settings), or null when there
   * isn't one or it no longer exists on disk. For pre-filling the picker.
   */
  lastCloneDirectory(): Promise<string | null>;
  /** Persisted recent repositories, ordered most-recently-opened first. */
  recent(): Promise<RecentRepo[]>;
  /**
   * Record a repository as just opened (stamping the time). Resolves with the
   * updated recent list, most-recently-opened first.
   */
  recordOpened(repo: RepoInfo): Promise<RecentRepo[]>;
  /** Remove a repository (by path) from the recent list; returns the rest. */
  forget(path: string): Promise<RecentRepo[]>;
  /**
   * Clone a repository into a new subfolder of `destination`, running
   * `git clone`. Resolves with the opened repo or an error message. Progress
   * arrives separately via `onCloneProgress`.
   */
  clone(request: CloneRequest): Promise<CloneResult>;
  /**
   * Subscribe to progress for the in-flight clone. Returns an unsubscribe
   * function; subscribe before calling `clone`.
   */
  onCloneProgress(callback: (progress: CloneProgress) => void): () => void;
  /**
   * Cancel this window's in-flight clone. The pending `clone` call then
   * resolves with `{ status: 'canceled' }` and the partial folder is removed.
   */
  cancelClone(): Promise<void>;
}

export interface IntegrationsApi {
  /** Read the current connection state for every provider. */
  list(): Promise<IntegrationsState>;
  /**
   * Begin authorizing a provider. Resolves quickly with the device-code prompt
   * to show the user; the connection then completes asynchronously and arrives
   * via `onChange`.
   */
  connect(provider: IntegrationProvider): Promise<DeviceCodePrompt>;
  /** Disconnect a provider, or cancel an in-progress flow. Resolves with state. */
  disconnect(provider: IntegrationProvider): Promise<IntegrationsState>;
  /**
   * List the connected account's repositories, most-recently-updated first.
   * Rejects if the provider is not connected.
   */
  repositories(provider: IntegrationProvider): Promise<RemoteRepo[]>;
  /** Subscribe to connection-state changes. Returns an unsubscribe function. */
  onChange(callback: (state: IntegrationsState) => void): () => void;
}

export interface ExposedApi {
  /** Host OS platform, mirrored from the main process' `process.platform`. */
  platform: NodeJS.Platform;
  theme: ThemeApi;
  app: AppApi;
  repo: RepoApi;
  integrations: IntegrationsApi;
}
