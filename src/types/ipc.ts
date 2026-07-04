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
  /** Renderer -> main (invoke): read persisted sidebar section open/closed map. */
  getSidebarSections: 'app:get-sidebar-sections',
  /** Renderer -> main (invoke): persist one sidebar section's open/closed state. */
  setSidebarSection: 'app:set-sidebar-section',
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

/** A local branch and its tracking status against its upstream. */
export interface LocalBranchInfo {
  /** Full short name, e.g. "feature/sidebar". */
  name: string;
  /** Whether this is the checked-out branch. */
  current: boolean;
  /** Commits ahead of its upstream (0 when none or no upstream). */
  ahead: number;
  /** Commits behind its upstream (0 when none or no upstream). */
  behind: number;
}

/** A remote-tracking branch, split into its remote and branch name. */
export interface RemoteBranchInfo {
  /** Remote name, e.g. "origin". */
  remote: string;
  /** Branch name under the remote, e.g. "main" or "feature/graph". */
  name: string;
}

/** A tag and the short hash of the object it points at. */
export interface TagInfo {
  name: string;
  hash: string;
}

/** A stash entry from `git stash list`. */
export interface StashInfo {
  /** Stash index, e.g. 0 for `stash@{0}` (0 is the most recent). */
  index: number;
  /** The stash subject, e.g. "WIP on main: 1a2b3c Some commit". */
  message: string;
  /** The branch the stash was taken on, when parseable from the subject. */
  branch?: string;
}

/** The refs of an open repository, for the sidebar. */
export interface RepoRefs {
  localBranches: LocalBranchInfo[];
  remoteBranches: RemoteBranchInfo[];
  tags: TagInfo[];
  stashes: StashInfo[];
}

/**
 * Outcome of an operation that mutates the repo and hands back its fresh refs
 * (checkout, stash pop/drop, gitflow start/finish).
 */
export type RefsMutationResult =
  | { status: 'ok'; refs: RepoRefs }
  | { status: 'error'; message: string };

/** Outcome of a branch checkout. On success it carries the repo's fresh refs. */
export type CheckoutResult = RefsMutationResult;

/** The three gitflow topic-branch kinds the sidebar can start/finish. */
export type GitflowKind = 'feature' | 'release' | 'hotfix';

/** A ref decoration attached to a commit (branch tip, tag, HEAD, …). */
export type RefKind = 'head' | 'branch' | 'remote' | 'tag';

export interface CommitRefDecoration {
  label: string;
  kind: RefKind;
}

/** One commit in the history, with the parent links the graph is drawn from. */
export interface CommitLogEntry {
  /** Full 40-char hash. */
  hash: string;
  /** Abbreviated hash for display. */
  shortHash: string;
  /** Full parent hashes (2+ means a merge). */
  parents: string[];
  author: string;
  /** Gravatar URL for the author's email (identicon fallback), for the graph node. */
  authorAvatarUrl: string;
  /** ISO 8601 author date. */
  date: string;
  /** First line of the commit message. */
  subject: string;
  refs: CommitRefDecoration[];
  /**
   * Set when this row is a local stash rather than a real commit: the stash's
   * index (`stash@{N}`). Stash rows are drawn with a dotted line down to the
   * commit they were taken from.
   */
  stashIndex?: number;
}

/** Status of a file within a commit or the working tree. */
export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed';

export interface FileChange {
  path: string;
  status: FileStatus;
}

/** The working tree split into staged (index) and unstaged changes. */
export interface WorkingStatus {
  staged: FileChange[];
  unstaged: FileChange[];
}

/** Outcome of a commit. */
export type CommitResult = { status: 'ok' } | { status: 'error'; message: string };

export const RepoChannels = {
  /** Renderer -> main (invoke): pick a folder and open it as a repository. */
  open: 'repo:open',
  /** Renderer -> main (invoke): list a repository's branches and tags. */
  listRefs: 'repo:list-refs',
  /** Renderer -> main (invoke): read commit history (newest first). */
  log: 'repo:log',
  /** Renderer -> main (invoke): read the files changed by a single commit. */
  commitFiles: 'repo:commit-files',
  /** Renderer -> main (invoke): read the working-tree status (staged/unstaged). */
  status: 'repo:status',
  /** Renderer -> main (invoke): stage a file (or all); returns fresh status. */
  stage: 'repo:stage',
  /** Renderer -> main (invoke): unstage a file (or all); returns fresh status. */
  unstage: 'repo:unstage',
  /** Renderer -> main (invoke): commit the staged changes. */
  commit: 'repo:commit',
  /** Renderer -> main (invoke): check out a branch; returns fresh refs. */
  checkout: 'repo:checkout',
  /** Renderer -> main (invoke): apply & drop a stash (`git stash pop`). */
  stashPop: 'repo:stash-pop',
  /** Renderer -> main (invoke): discard a stash (`git stash drop`). */
  stashDrop: 'repo:stash-drop',
  /** Renderer -> main (invoke): start a gitflow topic branch. */
  gitflowStart: 'repo:gitflow-start',
  /** Renderer -> main (invoke): finish the current gitflow topic branch. */
  gitflowFinish: 'repo:gitflow-finish',
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
  /** Renderer -> main (invoke): read the persisted open-tab repo paths. */
  openTabs: 'repo:open-tabs',
  /** Renderer -> main (invoke): persist the open-tab repo paths (in order). */
  saveOpenTabs: 'repo:save-open-tabs',
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

/** The authenticated user's profile, as read from a provider's `/user`. */
export interface IntegrationAccount {
  /** The account handle / username (e.g. GitHub login). */
  username: string;
  /** Display name, when the provider supplies one. */
  name?: string;
  /** Avatar image URL, when available. */
  avatarUrl?: string;
}

/** Connection state for a single provider. */
export interface IntegrationConnection {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  /** The connected account's handle, once known (status `connected`). */
  account?: string;
  /** The connected account's display name, when the provider supplies one. */
  name?: string;
  /** The connected account's avatar image URL, when available. */
  avatarUrl?: string;
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
  /**
   * Read the persisted open/closed state of the repo sidebar's collapsible
   * sections, keyed by section id. Missing keys default to closed, so a repo
   * opened for the first time shows every section collapsed.
   */
  getSidebarSections(): Promise<Record<string, boolean>>;
  /** Persist one sidebar section's open/closed state (keyed by section id). */
  setSidebarSection(key: string, open: boolean): Promise<void>;
}

export interface RepoApi {
  /**
   * Show the native folder picker and open the chosen directory as a git
   * repository. Resolves with the outcome (opened / canceled / not-a-repo).
   */
  open(): Promise<OpenRepoResult>;
  /**
   * Read the branches (local + remote-tracking) and tags of the repository at
   * `path`. Resolves with empty lists if the path isn't a git repository.
   */
  listRefs(path: string): Promise<RepoRefs>;
  /**
   * Read commit history for the repository at `path`, newest first, capped at
   * `limit` commits (default applied by the main process).
   */
  log(path: string, limit?: number): Promise<CommitLogEntry[]>;
  /** Read the files changed by the commit `hash` (vs its first parent). */
  commitFiles(path: string, hash: string): Promise<FileChange[]>;
  /** Read the working-tree status (staged + unstaged changes). */
  status(path: string): Promise<WorkingStatus>;
  /**
   * Stage `file` (a path), or everything when `file` is null. Resolves with the
   * refreshed working-tree status.
   */
  stage(path: string, file: string | null): Promise<WorkingStatus>;
  /** Unstage `file` (a path), or everything when null. Returns fresh status. */
  unstage(path: string, file: string | null): Promise<WorkingStatus>;
  /** Commit the currently staged changes with `message`. */
  commit(path: string, message: string): Promise<CommitResult>;
  /**
   * Check out `branch` in the repository at `path` (`git checkout`). Resolves
   * with the repo's fresh refs on success, or an error message (e.g. when the
   * working tree has conflicting local changes).
   *
   * Pass `remote` (e.g. "origin") when checking out a remote branch to force a
   * local tracking branch off that specific remote — this disambiguates the
   * case where several remotes share the branch name, which a bare
   * `git checkout <branch>` cannot resolve. Ignored if a local branch of that
   * name already exists (that local branch is simply switched to).
   */
  checkout(path: string, branch: string, remote?: string): Promise<CheckoutResult>;
  /**
   * Apply the stash at `index` and remove it from the stash list
   * (`git stash pop stash@{index}`). Resolves with fresh refs, or an error
   * (e.g. when applying would conflict with local changes).
   */
  stashPop(path: string, index: number): Promise<RefsMutationResult>;
  /** Discard the stash at `index` (`git stash drop`). Returns fresh refs. */
  stashDrop(path: string, index: number): Promise<RefsMutationResult>;
  /**
   * Start a gitflow topic branch: create and check out `<kind>/<name>` off the
   * appropriate base (develop for feature/release, main for hotfix — falling
   * back to the current branch when the base doesn't exist). Returns fresh refs.
   */
  gitflowStart(path: string, kind: GitflowKind, name: string): Promise<RefsMutationResult>;
  /**
   * Finish the current gitflow topic branch: merge it (no-ff) into its base
   * branch, delete the topic branch, and leave the base checked out. Errors if
   * HEAD isn't on a gitflow branch or the merge can't complete cleanly.
   */
  gitflowFinish(path: string): Promise<RefsMutationResult>;
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
   * The repository paths for the tabs that were open last session, in order.
   * Paths that no longer exist on disk are pruned. Restored on startup so the
   * same repositories reopen as tabs.
   */
  openTabs(): Promise<string[]>;
  /** Persist the open-tab repository paths (in tab order). */
  saveOpenTabs(paths: string[]): Promise<void>;
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
