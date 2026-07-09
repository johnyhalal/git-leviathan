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
  /** Renderer -> main (invoke): read the persisted default pull mode. */
  getPullMode: 'app:get-pull-mode',
  /** Renderer -> main (invoke): persist the default pull mode (global). */
  setPullMode: 'app:set-pull-mode',
  /** Main -> renderer (send): the main window regained OS focus. */
  focused: 'app:focused',
} as const;

export const UpdateChannels = {
  /** Renderer -> main (invoke): resolve a newer release, or null. */
  check: 'update:check',
  /** Renderer -> main (send): open the release page in the browser. */
  openRelease: 'update:open',
} as const;

/** A newer published release than the one currently running. */
export interface UpdateInfo {
  /** Latest published version, normalized (no leading "v"), e.g. "0.2.0". */
  version: string;
  /** GitHub release page URL to open in the browser. */
  releaseUrl: string;
}

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

/** The persisted tab session: the open repo paths and which one was active. */
export interface OpenTabsState {
  /** Open repository paths, in tab order (pruned to those still on disk). */
  paths: string[];
  /** Index into `paths` of the active tab; 0 when it can't be resolved. */
  activeIndex: number;
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

/** A configured remote and its fetch URL, used to badge it with its host. */
export interface RemoteInfo {
  /** Remote name, e.g. "origin". */
  name: string;
  /** Fetch URL, e.g. "git@github.com:owner/repo.git" (empty if unset). */
  url: string;
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
  /** The stash subject with the "On <branch>:" prefix stripped, e.g. "1a2b3c Some commit". */
  message: string;
  /** The branch the stash was taken on, when parseable from the subject. */
  branch?: string;
}

/** The refs of an open repository, for the sidebar. */
export interface RepoRefs {
  localBranches: LocalBranchInfo[];
  remoteBranches: RemoteBranchInfo[];
  /** Configured remotes with their URLs, for badging each remote's host. */
  remotes: RemoteInfo[];
  tags: TagInfo[];
  stashes: StashInfo[];
}

/**
 * Outcome of an operation that mutates the repo and hands back its fresh refs
 * (checkout, stash pop/drop, gitflow start/finish).
 */
export type RefsMutationResult =
  | {
      status: 'ok';
      refs: RepoRefs;
      /**
       * An informational note about a successful-but-no-op mutation, surfaced as
       * an info toast (e.g. a merge/rebase where the target was already up to
       * date). Absent when the mutation changed something.
       */
      notice?: string;
    }
  | { status: 'error'; message: string };

/** Outcome of a branch checkout. On success it carries the repo's fresh refs. */
export type CheckoutResult = RefsMutationResult;

/** The three gitflow topic-branch kinds the sidebar can start/finish. */
export type GitflowKind = 'feature' | 'release' | 'hotfix';

/**
 * How the toolbar's pull action reconciles with the upstream:
 * - `ff`        — `git pull` (fast-forward when possible, else a merge)
 * - `ff-only`   — `git pull --ff-only` (refuse anything but a fast-forward)
 * - `rebase`    — `git pull --rebase` (replay local commits on top)
 * - `fetch-all` — `git fetch --all` (update remotes without touching the branch)
 */
export type PullMode = 'ff' | 'ff-only' | 'rebase' | 'fetch-all';

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
  /**
   * Set on the synthetic top row that stands in for the working tree when it has
   * uncommitted changes. Drawn with an empty, dotted-ring node and no message;
   * selecting it opens the staging panel rather than a commit's details.
   */
  working?: boolean;
}

/** Sentinel hash for the synthetic working-tree ("uncommitted changes") row. */
export const WORKING_TREE_HASH = '__working_tree__';

/** Status of a file within a commit or the working tree. */
export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed';

export interface FileChange {
  path: string;
  status: FileStatus;
}

/**
 * Full detail for a single commit, loaded on demand for the detail panel.
 * `signature` is git's `%G?` status char: 'N' means unsigned, anything else
 * (G/U/X/Y/R/E/B) means a signature is present.
 */
export interface CommitDetailData {
  /** Full commit message (subject + body). */
  message: string;
  /** GPG signature status from `%G?`. */
  signature: string;
}

/** The working tree split into staged (index) and unstaged changes. */
export interface WorkingStatus {
  staged: FileChange[];
  unstaged: FileChange[];
}

/**
 * The revision a file's diff (or content) is taken against:
 * - `commit`   — the commit `hash`, diffed against its first parent.
 * - `staged`   — the index vs HEAD (a staged working-tree change).
 * - `unstaged` — the working tree vs the index (an unstaged change).
 */
export type DiffSource =
  | { kind: 'commit'; hash: string }
  | { kind: 'staged' }
  | { kind: 'unstaged' };

/** One row of a parsed unified diff. */
export interface DiffLine {
  /** `hunk` is the `@@ … @@` separator; the rest are content rows. */
  kind: 'context' | 'add' | 'delete' | 'hunk';
  /** 1-based old-side line number; null for added rows and hunk headers. */
  oldLine: number | null;
  /** 1-based new-side line number; null for deleted rows and hunk headers. */
  newLine: number | null;
  /** Line content without its leading +/-/space marker (raw `@@` line for a hunk). */
  text: string;
}

/** A single file's diff, parsed into rows for the diff viewer. */
export interface FileDiff {
  path: string;
  /** git treats the blob as binary — no textual diff is available. */
  binary: boolean;
  /** Parsed unified-diff rows (empty for a binary or unchanged file). */
  lines: DiffLine[];
}

/** Outcome of a commit. */
export type CommitResult = { status: 'ok' } | { status: 'error'; message: string };

/**
 * Outcome of a push. Beyond ok/error it can report `needs-upstream`: the current
 * branch has no upstream yet, so the caller should confirm publishing it to
 * `remote` under `branch` (via `pushSetUpstream`) before the branch is created
 * on the remote.
 */
export type PushResult =
  | { status: 'ok' }
  | { status: 'error'; message: string }
  | { status: 'needs-upstream'; remote: string; branch: string };

export const RepoChannels = {
  /** Renderer -> main (invoke): pick a folder and open it as a repository. */
  open: 'repo:open',
  /** Renderer -> main (invoke): list a repository's branches and tags. */
  listRefs: 'repo:list-refs',
  /** Renderer -> main (invoke): read commit history (newest first). */
  log: 'repo:log',
  /** Renderer -> main (invoke): read the files changed by a single commit. */
  commitFiles: 'repo:commit-files',
  /** Renderer -> main (invoke): list every file in a commit's tree snapshot. */
  commitTree: 'repo:commit-tree',
  /** Renderer -> main (invoke): read a single file's parsed unified diff. */
  fileDiff: 'repo:file-diff',
  /** Renderer -> main (invoke): read a single file's full content at a revision. */
  fileContent: 'repo:file-content',
  /** Renderer -> main (invoke): read a single commit's full message + signature. */
  commitDetail: 'repo:commit-detail',
  /** Renderer -> main (invoke): read the working-tree status (staged/unstaged). */
  status: 'repo:status',
  /** Renderer -> main (invoke): stage a file (or all); returns fresh status. */
  stage: 'repo:stage',
  /** Renderer -> main (invoke): unstage a file (or all); returns fresh status. */
  unstage: 'repo:unstage',
  /** Renderer -> main (invoke): discard every working-tree change; fresh status. */
  discardAll: 'repo:discard-all',
  /** Renderer -> main (invoke): commit the staged changes. */
  commit: 'repo:commit',
  /** Renderer -> main (invoke): reword a commit's message (amend / rebase). */
  reword: 'repo:reword',
  /** Renderer -> main (invoke): count the commits a reword of a commit would rebase. */
  rewordCount: 'repo:reword-count',
  /** Renderer -> main (invoke): push the current branch to its upstream. */
  push: 'repo:push',
  /** Renderer -> main (invoke): publish the current branch to a remote, setting upstream. */
  pushSetUpstream: 'repo:push-set-upstream',
  /** Renderer -> main (invoke): pull/fetch the current branch from its upstream. */
  pull: 'repo:pull',
  /** Renderer -> main (invoke): check out a branch; returns fresh refs. */
  checkout: 'repo:checkout',
  /** Renderer -> main (invoke): create a branch at HEAD; returns fresh refs. */
  createBranch: 'repo:create-branch',
  /** Renderer -> main (invoke): delete a local branch; returns fresh refs. */
  deleteBranch: 'repo:delete-branch',
  /** Renderer -> main (invoke): delete a branch on a remote; returns fresh refs. */
  deleteRemoteBranch: 'repo:delete-remote-branch',
  /** Renderer -> main (invoke): merge one branch into another; returns fresh refs. */
  merge: 'repo:merge',
  /** Renderer -> main (invoke): rebase one branch onto another; returns fresh refs. */
  rebase: 'repo:rebase',
  /** Renderer -> main (invoke): stash uncommitted changes (`git stash push`). */
  stashPush: 'repo:stash-push',
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
  /** Renderer -> main (send): watch this repo's working tree (null to stop). */
  watch: 'repo:watch',
  /** Main -> renderer (send): the watched repo's working tree changed on disk. */
  changed: 'repo:changed',
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
  /**
   * Read the persisted default pull mode for the toolbar's pull action. It's a
   * single global preference (not per-repo); defaults to `ff` when unset.
   */
  getPullMode(): Promise<PullMode>;
  /** Persist the default pull mode (global). */
  setPullMode(mode: PullMode): Promise<void>;
  /**
   * Subscribe to the main window regaining OS focus (e.g. the user switched
   * back to the app from another window). Fires each time; used to re-sync the
   * on-screen repo with what's on disk. Returns an unsubscribe function.
   */
  onWindowFocus(callback: () => void): () => void;
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
  /**
   * List every file path present in the commit `hash`'s tree (the full repo
   * snapshot as of that commit), for the detail panel's "View all files" mode.
   */
  commitTree(path: string, hash: string): Promise<string[]>;
  /**
   * Read the parsed unified diff of `file` at `source` (a commit against its
   * parent, or a staged/unstaged working-tree change).
   */
  fileDiff(path: string, source: DiffSource, file: string): Promise<FileDiff>;
  /**
   * Read `file`'s full content at `source` as an array of lines, for the diff
   * viewer's "file view". For an unstaged source this is the on-disk working
   * copy; otherwise it's the blob at that revision. Empty when absent/binary.
   */
  fileContent(path: string, source: DiffSource, file: string): Promise<string[]>;
  /** Read the commit `hash`'s full message and GPG signature status. */
  commitDetail(path: string, hash: string): Promise<CommitDetailData>;
  /** Read the working-tree status (staged + unstaged changes). */
  status(path: string): Promise<WorkingStatus>;
  /**
   * Stage `file` (a path), or everything when `file` is null. Resolves with the
   * refreshed working-tree status.
   */
  stage(path: string, file: string | null): Promise<WorkingStatus>;
  /** Unstage `file` (a path), or everything when null. Returns fresh status. */
  unstage(path: string, file: string | null): Promise<WorkingStatus>;
  /**
   * Discard every working-tree change: revert tracked modifications, unstage the
   * index, and delete untracked files/directories (`git reset --hard` + `git
   * clean -fd`). Irreversible. Resolves with the (now clean) working status.
   */
  discardAll(path: string): Promise<WorkingStatus>;
  /** Commit the currently staged changes with `message`. */
  commit(path: string, message: string): Promise<CommitResult>;
  /**
   * Rewrite the message of the commit `hash` to `message`. Amends HEAD directly;
   * for older commits it replays the history above them via a non-interactive
   * rebase, so every descendant commit is rewritten (new hashes).
   */
  reword(path: string, hash: string, message: string): Promise<CommitResult>;
  /**
   * Count how many commits a reword of `hash` would rewrite: the commit itself
   * plus every descendant up to HEAD that the rebase replays (1 when `hash` is
   * HEAD, since that's a plain amend).
   */
  rewordCount(path: string, hash: string): Promise<number>;
  /**
   * Push the current branch to its upstream. When the branch already tracks an
   * upstream, a plain push follows it. When it has no upstream yet, this does not
   * publish silently: it resolves `needs-upstream` (carrying the target remote and
   * branch) so the UI can confirm before creating the branch on the remote. Also
   * resolves ok on success, or an error message (detached HEAD, no remote, auth…).
   */
  push(path: string): Promise<PushResult>;
  /**
   * Publish the current branch to `remote`, setting it as the upstream
   * (`git push --set-upstream`). Called after the user confirms a
   * `needs-upstream` result from `push`. `branch` is the local branch;
   * `remoteBranch` is the name it takes on the remote (defaults to `branch`
   * when omitted/empty). Resolves ok, or an error message.
   */
  pushSetUpstream(
    path: string,
    remote: string,
    branch: string,
    remoteBranch?: string,
  ): Promise<CommitResult>;
  /**
   * Pull the current branch from its upstream using `mode` (or, for `fetch-all`,
   * fetch every remote without moving the branch). Resolves ok on success, or an
   * error message (no upstream, diverged history, conflicts, auth failure…).
   */
  pull(path: string, mode: PullMode): Promise<CommitResult>;
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
   * Create a new branch named `name` at HEAD and check it out
   * (`git checkout -b <name>`). Resolves with the repo's fresh refs on success,
   * or an error message (invalid name, a branch of that name already exists,
   * empty HEAD…).
   */
  createBranch(path: string, name: string): Promise<RefsMutationResult>;
  /**
   * Delete the local branch `branch` (`git branch -D`). Refuses to delete the
   * checked-out branch. Resolves with the repo's fresh refs on success, or an
   * error message.
   */
  deleteBranch(path: string, branch: string): Promise<RefsMutationResult>;
  /**
   * Delete `branch` on `remote` (`git push <remote> --delete <branch>`), which
   * also prunes the local remote-tracking ref. Resolves with the repo's fresh
   * refs on success, or an error message (unknown remote, auth failure…).
   */
  deleteRemoteBranch(path: string, remote: string, branch: string): Promise<RefsMutationResult>;
  /**
   * Merge `source` into `target`: check out `target`, then `git merge source`.
   * Both must be existing local branches. Resolves with fresh refs on success,
   * or an error message (e.g. merge conflicts, which abort the merge).
   */
  merge(path: string, source: string, target: string): Promise<RefsMutationResult>;
  /**
   * Rebase `source` into `target`: check out `target`, then `git rebase source`,
   * replaying `target`'s commits on top of `source` for a linear history. Both
   * must be existing local branches. Resolves with fresh refs, or an error
   * message (e.g. conflicts, which abort the rebase).
   */
  rebase(path: string, source: string, target: string): Promise<RefsMutationResult>;
  /**
   * Stash the working tree's uncommitted changes (`git stash push`, including
   * untracked files). Resolves with fresh refs, or an error (e.g. when there is
   * nothing to stash).
   */
  stashPush(path: string): Promise<RefsMutationResult>;
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
   * The repository paths for the tabs that were open last session, in order,
   * plus the index of the one that was active. Paths that no longer exist on
   * disk are pruned (and the active index is re-resolved against what remains).
   * Restored on startup so the same repositories reopen with the same selection.
   */
  openTabs(): Promise<OpenTabsState>;
  /**
   * Persist the open-tab repository paths (in tab order) and the active tab's
   * path (null when the active tab is an empty "New Tab" with no repository).
   */
  saveOpenTabs(paths: string[], activePath: string | null): Promise<void>;
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
  /**
   * Ask the main process to watch a repository's working tree for on-disk
   * changes made outside the app (edits from an editor, commits from a
   * terminal). Pass a path to (re)start watching that repo, or null to stop.
   * Changes arrive, debounced, via `onRepoChanged`.
   */
  watch(path: string | null): void;
  /**
   * Subscribe to on-disk changes for the currently watched repo; the callback
   * receives the changed repo's path. Returns an unsubscribe function.
   */
  onRepoChanged(callback: (path: string) => void): () => void;
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

export interface UpdateApi {
  /**
   * Check GitHub for the latest published release. Resolves with the release
   * when it's newer than the running app, or null (no update, or the check
   * failed — offline, rate-limited, no releases). Never rejects.
   */
  check(): Promise<UpdateInfo | null>;
  /** Open a release page (github.com URL) in the default browser. */
  openRelease(url: string): void;
}

export interface ExposedApi {
  /** Host OS platform, mirrored from the main process' `process.platform`. */
  platform: NodeJS.Platform;
  /** The running app version (from the main process' `app.getVersion()`). */
  version: string;
  theme: ThemeApi;
  app: AppApi;
  repo: RepoApi;
  integrations: IntegrationsApi;
  update: UpdateApi;
}
