import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  safeStorage,
  screen,
  shell,
} from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import started from 'electron-squirrel-startup';
import { gitBin, gitEnv, initShellPath } from './git';
import {
  probeClaude,
  generateCommitMessage,
  claudeErrorMessage,
  isRunnable,
} from './claude';
import {
  AppChannels,
  ClaudeChannels,
  IntegrationChannels,
  RepoChannels,
  ThemeChannels,
  UpdateChannels,
  GLOBAL_ACTIVITY_PATH,
  type ClaudeStatus,
  type GenerateCommitResult,
  type CloneProgress,
  type CloneRequest,
  type CloneResult,
  type DeviceCodePrompt,
  type IntegrationConnection,
  type IntegrationProvider,
  type CheckoutResult,
  type RefsMutationResult,
  type RepoActivityEvent,
  type UndoRedoState,
  type GitflowKind,
  type GitflowConfig,
  type GitflowConfigResult,
  type StashInfo,
  type WorktreeInfo,
  type WorktreeAddOptions,
  type CommitLogEntry,
  type CommitRefDecoration,
  type CommitDetailData,
  type CommitResult,
  type DiffSource,
  type DiffLine,
  type FileChange,
  type FileDiff,
  type FileStatus,
  type WorkingStatus,
  type MergeOp,
  type MergeState,
  type ConflictFile,
  type ConflictKind,
  type ConflictFileContent,
  type MergeResolution,
  type MarkResolvedResult,
  type IntegrationsState,
  type NewPullRequest,
  type PullRequestListResult,
  type CreatePullRequestResult,
  type NewFeedback,
  type CreateIssueResult,
  type RepoHost,
  type LocalBranchInfo,
  type OpenRepoResult,
  type OpenTabsState,
  type PullMode,
  type PushResult,
  type UpdateCheckInterval,
  UPDATE_CHECK_INTERVALS,
  DEFAULT_UPDATE_CHECK_INTERVAL,
  type RecentRepo,
  type RemoteBranchInfo,
  type RemoteInfo,
  type RemoteRepo,
  type RepoInfo,
  type SshKeyInfo,
  type RepoRefs,
  type TagInfo,
  type ThemeSource,
  type ThemeState,
  type UpdateInfo,
  type UpdateStatus,
} from './types/ipc';
import type { DeviceAuthorization } from './oauth/deviceFlow';
import * as github from './oauth/github';
import * as gitlab from './oauth/gitlab';
import { generateSshKeyPair } from './ssh/keygen';

// Name the app before anything reads it, so app.getName(), the userData path,
// notifications and the About panel all say "GitLeviathan" rather than
// Electron's default. (In dev the dock/menu label additionally comes from the
// Electron.app bundle's Info.plist — see scripts/rename-dev-app.mjs.)
// The unpackaged (dev) build gets a distinct name so it resolves a separate
// userData dir ("GitLeviathan Dev") and never shares settings.json /
// integration-tokens.json with an installed production app.
app.setName(app.isPackaged ? 'GitLeviathan' : 'GitLeviathan Dev');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

/** Minimum time the splash stays visible so it never just flashes. */
const MIN_SPLASH_MS = 2000;
const THEME_SOURCES: ThemeSource[] = ['system', 'light', 'dark'];
const INTEGRATION_PROVIDERS: IntegrationProvider[] = ['github', 'gitlab'];
const preloadPath = path.join(__dirname, 'preload.js');

// OAuth client ids (public — device flow needs no secret). A real launch-time
// env var wins; otherwise the value comes from `.env`, baked into the bundle at
// build time (see vite.main.config.ts). Empty means that provider is
// unconfigured, and connecting it surfaces a clear message.
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || __GITHUB_CLIENT_ID__;
const GITLAB_CLIENT_ID = process.env.GITLAB_CLIENT_ID || __GITLAB_CLIENT_ID__;

/** Everything the integrations layer needs to drive one provider's device flow. */
interface ProviderClient {
  /** Public OAuth client id, or empty when unconfigured. */
  clientId: string;
  /**
   * Scopes to request — enough to list and clone repos, read the handle,
   * push changes to GitHub Actions workflow files (`workflow`), and upload an
   * SSH key (`write:public_key` on GitHub, write `api` on GitLab).
   */
  scope: string;
  requestDeviceAuthorization: typeof github.requestDeviceAuthorization;
  pollForAccessToken: typeof github.pollForAccessToken;
  fetchAccount: typeof github.fetchAccount;
  fetchUserRepos: typeof github.fetchUserRepos;
  fetchPullRequests: typeof github.fetchPullRequests;
  createPullRequest: typeof github.createPullRequest;
  uploadSshKey: typeof github.uploadSshKey;
  deleteSshKey: typeof github.deleteSshKey;
}

// One entry per provider; the connect/list handlers are otherwise generic.
const PROVIDER_CLIENTS: Record<IntegrationProvider, ProviderClient> = {
  github: {
    clientId: GITHUB_CLIENT_ID,
    scope: 'repo workflow read:user write:public_key',
    requestDeviceAuthorization: github.requestDeviceAuthorization,
    pollForAccessToken: github.pollForAccessToken,
    fetchAccount: github.fetchAccount,
    fetchUserRepos: github.fetchUserRepos,
    fetchPullRequests: github.fetchPullRequests,
    createPullRequest: github.createPullRequest,
    uploadSshKey: github.uploadSshKey,
    deleteSshKey: github.deleteSshKey,
  },
  gitlab: {
    clientId: GITLAB_CLIENT_ID,
    // `api` (read-write) is required to add an SSH key; it also covers cloning.
    scope: 'api',
    requestDeviceAuthorization: gitlab.requestDeviceAuthorization,
    pollForAccessToken: gitlab.pollForAccessToken,
    fetchAccount: gitlab.fetchAccount,
    fetchUserRepos: gitlab.fetchUserRepos,
    fetchPullRequests: gitlab.fetchPullRequests,
    createPullRequest: gitlab.createPullRequest,
    uploadSshKey: gitlab.uploadSshKey,
    deleteSshKey: gitlab.deleteSshKey,
  },
};

// ---- Tiny settings persistence -------------------------------------------

interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

interface Settings {
  themeSource: ThemeSource;
  windowBounds?: WindowBounds;
  windowMaximized?: boolean;
  /** Directory last browsed in the "open repository" picker. */
  lastRepoDir?: string;
  /** Directory last chosen as a clone destination. */
  lastCloneDir?: string;
  /** Recently opened repositories, most-recently-opened first. */
  recentRepos?: RecentRepo[];
  /** Repository paths open as tabs last session, in tab order. */
  openTabs?: string[];
  /** Path of the tab that was active last session (absent for an empty tab). */
  activeTab?: string;
  /** Repo sidebar collapsible sections' open/closed state, keyed by section id. */
  sidebarSections?: Record<string, boolean>;
  /** Default pull mode for the toolbar's pull action (global, not per-repo). */
  pullMode?: PullMode;
  /** Auto-update check interval in minutes; `0` disables the periodic check. */
  updateCheckInterval?: UpdateCheckInterval;
  /** Connected Git host accounts, keyed by provider id. */
  integrations?: Partial<Record<IntegrationProvider, IntegrationConnection>>;
  /** SSH keys generated and uploaded from this app, keyed by provider id. */
  sshKeys?: Partial<Record<IntegrationProvider, SshKeyInfo[]>>;
  /** Saved Claude Code connection (detected `claude` binary), when connected. */
  claudeConnection?: ClaudeConnection;
}

/** The persisted Claude Code connection: the binary we detected on connect. */
interface ClaudeConnection {
  binaryPath: string;
  version?: string;
}

const DEFAULT_WINDOW = { width: 1100, height: 720 } as const;

/** Cap on the persisted recent list so it can't grow without bound. */
const MAX_RECENT_REPOS = 20;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

// In-memory cache, loaded once at startup and persisted whole so independent
// writers (theme, window bounds) never clobber each other's fields.
const settings: Settings = { themeSource: 'system' };

function isWindowBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== 'object') return false;
  const b = value as Record<string, unknown>;
  const optionalNumber = (v: unknown) =>
    v === undefined || typeof v === 'number';
  return (
    typeof b.width === 'number' &&
    b.width > 0 &&
    typeof b.height === 'number' &&
    b.height > 0 &&
    optionalNumber(b.x) &&
    optionalNumber(b.y)
  );
}

function isRecentRepo(value: unknown): value is RecentRepo {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.name === 'string' &&
    typeof r.path === 'string' &&
    typeof r.lastOpenedAt === 'number' &&
    (r.favorite === undefined || typeof r.favorite === 'boolean')
  );
}

function isIntegrationProvider(value: unknown): value is IntegrationProvider {
  return (
    typeof value === 'string' &&
    (INTEGRATION_PROVIDERS as string[]).includes(value)
  );
}

function isNewPullRequest(value: unknown): value is NewPullRequest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === 'string' &&
    typeof v.body === 'string' &&
    typeof v.sourceBranch === 'string' &&
    typeof v.targetBranch === 'string' &&
    typeof v.draft === 'boolean'
  );
}

function isNewFeedback(value: unknown): value is NewFeedback {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (v.kind === 'bug' || v.kind === 'feature') &&
    typeof v.title === 'string' &&
    typeof v.details === 'string'
  );
}

function isIntegrationConnection(
  value: unknown,
): value is IntegrationConnection {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return (
    isIntegrationProvider(c.provider) &&
    (c.status === 'disconnected' ||
      c.status === 'connecting' ||
      c.status === 'connected') &&
    (c.account === undefined || typeof c.account === 'string') &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.avatarUrl === undefined || typeof c.avatarUrl === 'string')
  );
}

function isSshKeyInfo(value: unknown): value is SshKeyInfo {
  if (!value || typeof value !== 'object') return false;
  const k = value as Record<string, unknown>;
  return (
    isIntegrationProvider(k.provider) &&
    typeof k.title === 'string' &&
    typeof k.fingerprint === 'string' &&
    typeof k.fingerprintMd5 === 'string' &&
    typeof k.publicKey === 'string' &&
    typeof k.privateKeyPath === 'string' &&
    typeof k.remoteId === 'number' &&
    typeof k.createdAt === 'number'
  );
}

function isClaudeConnection(value: unknown): value is ClaudeConnection {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.binaryPath === 'string' &&
    (c.version === undefined || typeof c.version === 'string')
  );
}

function loadSettings(): void {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(settingsPath(), 'utf-8'),
    ) as Partial<Settings>;
    if (parsed.themeSource && THEME_SOURCES.includes(parsed.themeSource)) {
      settings.themeSource = parsed.themeSource;
    }
    if (isWindowBounds(parsed.windowBounds)) {
      settings.windowBounds = parsed.windowBounds;
    }
    settings.windowMaximized = parsed.windowMaximized === true;
    if (typeof parsed.lastRepoDir === 'string') {
      settings.lastRepoDir = parsed.lastRepoDir;
    }
    if (typeof parsed.lastCloneDir === 'string') {
      settings.lastCloneDir = parsed.lastCloneDir;
    }
    if (Array.isArray(parsed.recentRepos)) {
      settings.recentRepos = parsed.recentRepos.filter(isRecentRepo);
    }
    if (Array.isArray(parsed.openTabs)) {
      settings.openTabs = parsed.openTabs.filter(
        (p): p is string => typeof p === 'string',
      );
    }
    if (typeof parsed.activeTab === 'string') {
      settings.activeTab = parsed.activeTab;
    }
    if (parsed.sidebarSections && typeof parsed.sidebarSections === 'object') {
      const raw = parsed.sidebarSections as Record<string, unknown>;
      const valid: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'boolean') valid[key] = value;
      }
      settings.sidebarSections = valid;
    }
    if (PULL_MODES.includes(parsed.pullMode as PullMode)) {
      settings.pullMode = parsed.pullMode as PullMode;
    }
    if (UPDATE_CHECK_INTERVALS.includes(parsed.updateCheckInterval as UpdateCheckInterval)) {
      settings.updateCheckInterval = parsed.updateCheckInterval as UpdateCheckInterval;
    }
    if (parsed.integrations && typeof parsed.integrations === 'object') {
      const raw = parsed.integrations as Record<string, unknown>;
      const valid: Partial<Record<IntegrationProvider, IntegrationConnection>> =
        {};
      for (const provider of INTEGRATION_PROVIDERS) {
        const conn = raw[provider];
        // Keep only well-formed entries whose provider matches their key.
        if (isIntegrationConnection(conn) && conn.provider === provider) {
          valid[provider] = conn;
        }
      }
      settings.integrations = valid;
    }
    if (parsed.sshKeys && typeof parsed.sshKeys === 'object') {
      const raw = parsed.sshKeys as Record<string, unknown>;
      const valid: Partial<Record<IntegrationProvider, SshKeyInfo[]>> = {};
      for (const provider of INTEGRATION_PROVIDERS) {
        const keys = raw[provider];
        if (Array.isArray(keys)) {
          const kept = keys.filter(isSshKeyInfo);
          if (kept.length) valid[provider] = kept;
        }
      }
      settings.sshKeys = valid;
    }
    if (isClaudeConnection(parsed.claudeConnection)) {
      settings.claudeConnection = parsed.claudeConnection;
    }
  } catch {
    // No settings file yet or it is unreadable — fall back to defaults.
  }
}

function saveSettings(): void {
  try {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify(settings, null, 2),
      'utf-8',
    );
  } catch (err) {
    console.error('Failed to persist settings:', err);
  }
}

/**
 * Whether a saved position still lands on a connected display. Guards against
 * restoring a window off-screen after a monitor is unplugged or rearranged.
 */
function isPositionVisible(bounds: WindowBounds): boolean {
  if (bounds.x === undefined || bounds.y === undefined) return false;
  const { x, y, width, height } = bounds;
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX =
      Math.min(x + width, workArea.x + workArea.width) - Math.max(x, workArea.x);
    const overlapY =
      Math.min(y + height, workArea.y + workArea.height) -
      Math.max(y, workArea.y);
    // Require a usable slice of the window — including its draggable top bar —
    // to remain reachable on some display.
    return overlapX > 120 && overlapY > 48;
  });
}

// ---- Theme ----------------------------------------------------------------

function themeState(): ThemeState {
  return {
    source: nativeTheme.themeSource,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  };
}

function registerThemeIpc(): void {
  ipcMain.handle(ThemeChannels.get, () => themeState());

  ipcMain.handle(ThemeChannels.set, (_event, source: ThemeSource) => {
    if (!THEME_SOURCES.includes(source)) {
      throw new Error(`Invalid theme source: ${String(source)}`);
    }
    nativeTheme.themeSource = source;
    settings.themeSource = source;
    saveSettings();
    return themeState();
  });

  // Broadcast OS-level (and programmatic) theme changes to every window so the
  // renderers can react even though styling is driven by `prefers-color-scheme`.
  nativeTheme.on('updated', () => {
    const state = themeState();
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(ThemeChannels.changed, state);
    }
  });
}

// ---- Repositories ---------------------------------------------------------

/**
 * A directory is a git repository root when it contains a `.git` entry — a
 * directory for a normal clone, or a file for worktrees and submodules.
 */
function isGitRepo(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

/**
 * Normalize a filesystem path for equality checks: resolve `.`/`..` and drop a
 * trailing separator, and lowercase on the case-insensitive default platforms
 * (macOS/Windows) so two spellings of the same worktree compare equal.
 */
function normalizePath(p: string): string {
  if (!p) return '';
  const resolved = path.resolve(p);
  return process.platform === 'linux' ? resolved : resolved.toLowerCase();
}

/** Folder name a clone would land in, derived from the repo URL. */
function repoNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  // Handles both "https://host/owner/repo" and scp-like "git@host:owner/repo".
  const segment = cleaned.split(/[/:]/).pop() ?? '';
  return segment || 'repository';
}

/** The connected provider that owns a host, when we authenticate its clones. */
function providerForHost(hostname: string): IntegrationProvider | null {
  if (hostname === 'github.com') return 'github';
  if (hostname === 'gitlab.com') return 'gitlab';
  return null;
}

/**
 * Parse a remote URL into the connected host, owner and repo it points at, or
 * null when it isn't a supported host (github.com / gitlab.com). Handles both
 * HTTPS URLs and scp-like SSH remotes (`git@github.com:owner/repo.git`), and
 * keeps GitLab subgroup paths intact (owner is everything before the last
 * segment, so `group/subgroup/repo` round-trips).
 */
function parseRepoHost(remoteUrl: string): RepoHost | null {
  let hostname: string;
  let repoPath: string;
  const scp = /^[^/@]+@([^:/]+):(.+)$/.exec(remoteUrl.trim());
  if (scp) {
    hostname = scp[1];
    repoPath = scp[2];
  } else {
    try {
      const parsed = new URL(remoteUrl);
      hostname = parsed.hostname;
      repoPath = parsed.pathname.replace(/^\//, '');
    } catch {
      return null;
    }
  }
  const provider = providerForHost(hostname);
  if (!provider) return null;
  const cleaned = repoPath.replace(/\.git$/, '').replace(/\/$/, '');
  const slash = cleaned.lastIndexOf('/');
  if (slash <= 0) return null;
  const owner = cleaned.slice(0, slash);
  const repo = cleaned.slice(slash + 1);
  if (!owner || !repo) return null;
  return { provider, owner, repo };
}

/** The HTTPS-basic username each provider pairs with an OAuth token. */
const CLONE_AUTH_USERNAME: Record<IntegrationProvider, string> = {
  github: 'x-access-token',
  gitlab: 'oauth2',
};

/**
 * Embed the stored token into an HTTPS github.com / gitlab.com URL so private
 * repos clone without a credential prompt. Returns the (possibly rewritten) URL
 * plus the token used, if any, so the caller can redact it from output. Other
 * hosts/URLs are returned unchanged with a null token.
 */
function authenticatedCloneUrl(url: string): {
  url: string;
  token: string | null;
} {
  try {
    const parsed = new URL(url);
    const provider =
      parsed.protocol === 'https:' ? providerForHost(parsed.hostname) : null;
    if (provider) {
      const token = getToken(provider);
      if (token) {
        parsed.username = CLONE_AUTH_USERNAME[provider];
        parsed.password = token;
        return { url: parsed.toString(), token };
      }
    }
  } catch {
    // Not a standard URL (e.g. scp-like SSH) — clone it verbatim.
  }
  return { url, token: null };
}

/** Strip a token and any inline URL credentials from text shown to the user. */
function redactSecrets(text: string, token: string | null): string {
  let out = text;
  if (token) out = out.split(token).join('***');
  return out.replace(/\/\/[^@\s/]+@/g, '//');
}

/**
 * Leading `-c` git options that authenticate an HTTPS github.com / gitlab.com
 * remote with the stored OAuth token, by adding a host-scoped `Authorization`
 * header — so push/pull/fetch don't hit a credential prompt (which
 * `GIT_TERMINAL_PROMPT=0` turns into a hard failure). Empty when the URL isn't
 * an authenticatable HTTPS host or no token is stored, letting git fall back to
 * its own credential lookup. Unlike embedding the token in the URL, the header
 * approach leaves the command's refspecs untouched.
 */
function remoteAuthConfigArgs(remoteUrl: string): string[] {
  try {
    const parsed = new URL(remoteUrl);
    if (parsed.protocol !== 'https:') return [];
    const provider = providerForHost(parsed.hostname);
    if (!provider) return [];
    const token = getToken(provider);
    if (!token) return [];
    const basic = Buffer.from(
      `${CLONE_AUTH_USERNAME[provider]}:${token}`,
    ).toString('base64');
    // Scope the header to this remote's host so it's never sent elsewhere.
    const base = `${parsed.protocol}//${parsed.host}/`;
    return ['-c', `http.${base}.extraheader=Authorization: Basic ${basic}`];
  } catch {
    // Not a standard URL (e.g. an scp-like SSH remote) — nothing to inject.
    return [];
  }
}

/**
 * Auth `-c` args for the given remotes (deduped by host), for prefixing a
 * push/pull/fetch that talks to them. Reads each remote's fetch URL to decide.
 */
async function authArgsForRemotes(
  cwd: string,
  remotes: string[],
): Promise<string[]> {
  const args: string[] = [];
  const seen = new Set<string>();
  for (const remote of remotes) {
    const url = (await runGit(cwd, ['remote', 'get-url', remote])).trim();
    if (!url) continue;
    const configArg = remoteAuthConfigArgs(url)[1];
    if (configArg && !seen.has(configArg)) {
      seen.add(configArg);
      args.push('-c', configArg);
    }
  }
  return args;
}

/** The remote name embedded in an upstream ref like `origin/main` (before the first `/`). */
function remoteOfUpstream(upstream: string): string {
  const slash = upstream.indexOf('/');
  return slash === -1 ? upstream : upstream.slice(0, slash);
}

/** Single-quote a value for a POSIX shell — git splits `GIT_SSH_COMMAND` with
 *  shell-word rules (`sh -c` on macOS/Linux, its own splitter on Windows), so a
 *  key path with spaces must be quoted. */
function shellQuoteArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The connected provider owning an SSH remote's host, or null when the URL isn't
 * an SSH remote — a scp-like `git@host:path` or an explicit `ssh://…` — on a
 * supported host (github.com / gitlab.com). HTTPS URLs return null: they're
 * authenticated with the OAuth token instead (see {@link remoteAuthConfigArgs}).
 */
function sshProviderForUrl(remoteUrl: string): IntegrationProvider | null {
  const url = remoteUrl.trim();
  let hostname: string;
  const scp = /^[^/@]+@([^:/]+):(.+)$/.exec(url);
  if (scp) {
    hostname = scp[1];
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'ssh:') return null;
      hostname = parsed.hostname;
    } catch {
      return null;
    }
  }
  return providerForHost(hostname);
}

/**
 * The `GIT_SSH_COMMAND` for an SSH remote whose host has a key this app
 * generated and uploaded: `ssh -i <key> -o IdentitiesOnly=yes`, so git
 * authenticates with our own key rather than falling back to the ssh agent
 * (e.g. 1Password) — the fallback that otherwise surfaces an extra credential
 * prompt on push/pull. Null for HTTPS URLs, unsupported hosts, or a host we hold
 * no key for (or whose key file has since been removed), leaving ssh's own key
 * resolution untouched. `IdentitiesOnly=yes` is the load-bearing flag: without it
 * ssh still offers agent keys first.
 */
function sshCommandForUrl(remoteUrl: string): string | null {
  const provider = sshProviderForUrl(remoteUrl);
  if (!provider) return null;
  const keyPath = settings.sshKeys?.[provider]?.[0]?.privateKeyPath;
  if (!keyPath || !fs.existsSync(keyPath)) return null;
  return `ssh -i ${shellQuoteArg(keyPath)} -o IdentitiesOnly=yes`;
}

/**
 * The `GIT_SSH_COMMAND` env addition for a push/pull/fetch talking to the given
 * remotes (deduped by resulting command). Empty unless exactly one distinct SSH
 * command applies: no SSH remote we hold a key for means ssh keeps its default
 * resolution, and remotes needing *different* keys (a rare `fetch --all` across
 * both providers) can't share one command, so we inject nothing rather than force
 * the wrong identity on one of them.
 */
async function sshEnvForRemotes(
  cwd: string,
  remotes: string[],
): Promise<{ GIT_SSH_COMMAND?: string }> {
  const commands = new Set<string>();
  for (const remote of remotes) {
    const url = (await runGit(cwd, ['remote', 'get-url', remote])).trim();
    if (!url) continue;
    const command = sshCommandForUrl(url);
    if (command) commands.add(command);
  }
  if (commands.size !== 1) return {};
  return { GIT_SSH_COMMAND: [...commands][0] };
}

interface RunningClone {
  child: ChildProcess;
  /** Folder git is cloning into, removed if the clone is canceled. */
  target: string;
  canceled: boolean;
}

// In-flight clones keyed by the requesting window's webContents id. The clone
// UI is modal, so at most one runs per window — cancel targets that one.
const runningClones = new Map<number, RunningClone>();

const execFileAsync = promisify(execFile);

/**
 * Run a read-only git command in `cwd` and return its stdout. Failures (git
 * missing, not a repo, bad ref) resolve to an empty string so callers degrade
 * to empty lists rather than throwing across the IPC boundary.
 */
async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(gitBin, args, {
      cwd,
      env: gitEnv({ GIT_TERMINAL_PROMPT: '0' }),
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return '';
  }
}

/** Whether a local branch named `branch` already exists in the repo at `cwd`. */
async function localBranchExists(cwd: string, branch: string): Promise<boolean> {
  const out = await runGit(cwd, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  ]);
  return out.trim().length > 0;
}

/** Whether `ref` resolves to a commit in the repo at `cwd` (a local branch, a
 * remote-tracking branch, a tag, a hash, …). */
async function commitishExists(cwd: string, ref: string): Promise<boolean> {
  const out = await runGit(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return out.trim().length > 0;
}

/** The checked-out branch's short name, or '' when detached / on error. */
async function currentBranchName(cwd: string): Promise<string> {
  const out = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const name = out.trim();
  return name === 'HEAD' ? '' : name;
}

/**
 * Validate an untrusted (repo, source, target) branch-pair from IPC for a merge
 * or rebase: the path must be a repo, both branches must be strings naming
 * distinct, existing local branches. Returns an error message, or null when the
 * pair is safe to act on.
 */
async function validateBranchPair(
  repoPath: unknown,
  source: unknown,
  target: unknown,
): Promise<string | null> {
  if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
    return 'Not a git repository.';
  }
  if (typeof source !== 'string' || source.length === 0 ||
      typeof target !== 'string' || target.length === 0) {
    return 'No branch was specified.';
  }
  if (source === target) return 'Choose two different branches.';
  if (!(await localBranchExists(repoPath, source))) {
    return `Branch “${source}” doesn’t exist.`;
  }
  if (!(await localBranchExists(repoPath, target))) {
    return `Branch “${target}” doesn’t exist.`;
  }
  return null;
}

/** Whether `ref` resolves to a commit in the repo (a branch, tag, or sha). */
async function refExists(cwd: string, ref: string): Promise<boolean> {
  const out = await runGit(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return out.trim().length > 0;
}

/** The first of `candidates` that exists as a local branch, or null. */
async function firstExistingBranch(
  cwd: string,
  candidates: string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    if (await localBranchExists(cwd, candidate)) return candidate;
  }
  return null;
}

const nonEmptyLines = (text: string): string[] =>
  text.split('\n').filter((line) => line.length > 0);

async function readLocalBranches(cwd: string): Promise<LocalBranchInfo[]> {
  // %(HEAD) is "*" for the current branch; %(upstream:short) is the tracking
  // branch like "origin/main" (empty when none); %(upstream:track) yields text
  // like "[ahead 2, behind 1]", "[ahead 2]", "[gone]" or empty.
  const out = await runGit(cwd, [
    'for-each-ref',
    '--format=%(HEAD)\t%(refname:short)\t%(upstream:short)\t%(upstream:track)',
    'refs/heads',
  ]);
  return nonEmptyLines(out).map((line) => {
    const [head, name, upstream = '', track = ''] = line.split('\t');
    const ahead = /ahead (\d+)/.exec(track);
    const behind = /behind (\d+)/.exec(track);
    return {
      name,
      upstream,
      current: head === '*',
      ahead: ahead ? Number(ahead[1]) : 0,
      behind: behind ? Number(behind[1]) : 0,
    };
  });
}

async function readRemoteBranches(cwd: string): Promise<RemoteBranchInfo[]> {
  const out = await runGit(cwd, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/remotes',
  ]);
  return nonEmptyLines(out).flatMap((short) => {
    // "origin/main" -> { remote: "origin", name: "main" }; skip the symbolic
    // "origin/HEAD" pointer.
    const slash = short.indexOf('/');
    if (slash === -1) return [];
    const name = short.slice(slash + 1);
    if (name === 'HEAD') return [];
    return [{ remote: short.slice(0, slash), name }];
  });
}

async function readRemotes(cwd: string): Promise<RemoteInfo[]> {
  // "origin\tgit@github.com:owner/repo.git (fetch)" lines, one fetch + one push
  // per remote. Keep the fetch URL, deduped by remote name.
  const out = await runGit(cwd, ['remote', '-v']);
  const byName = new Map<string, string>();
  for (const line of nonEmptyLines(out)) {
    const match = /^(\S+)\t(\S+)\s+\(fetch\)$/.exec(line);
    if (match) byName.set(match[1], match[2]);
  }
  return [...byName.entries()].map(([name, url]) => ({ name, url }));
}

async function readTags(cwd: string): Promise<TagInfo[]> {
  const out = await runGit(cwd, [
    'for-each-ref',
    '--sort=-creatordate',
    '--format=%(refname:short)\t%(objectname:short)',
    'refs/tags',
  ]);
  return nonEmptyLines(out).map((line) => {
    const [name, hash = ''] = line.split('\t');
    return { name, hash };
  });
}

/**
 * Split a stash subject into its "WIP on <branch>:" / "On <branch>:" prefix and
 * the remaining message. Git names stashes "WIP on <branch>: <sha> <subject>"
 * (auto) or "On <branch>: <message>" (when created with `git stash push -m`); the
 * branch is surfaced separately so callers can drop that prefix from the text
 * they display.
 */
function parseStashSubject(subject: string): { branch?: string; message: string } {
  const prefix = /^(?:WIP on|On) ([^:]+):\s*/.exec(subject);
  if (!prefix) return { message: subject };
  return { branch: prefix[1], message: subject.slice(prefix[0].length) };
}

async function readStashes(cwd: string): Promise<StashInfo[]> {
  // %gd = the "stash@{N}" selector, %gs = the stash subject; \t (%x09) between.
  const out = await runGit(cwd, ['stash', 'list', '--format=%gd%x09%gs']);
  return nonEmptyLines(out).flatMap((line) => {
    const [selector, subject = ''] = line.split('\t');
    const match = /stash@\{(\d+)\}/.exec(selector);
    if (!match) return [];
    const { branch, message } = parseStashSubject(subject);
    return [{ index: Number(match[1]), message, branch }];
  });
}

/**
 * List the repository's linked working trees (`git worktree list --porcelain`).
 * The porcelain output is one blank-line-delimited block per worktree — the main
 * one first — each with `worktree <path>`, `HEAD <sha>`, and either
 * `branch refs/heads/<name>`, `detached`, or `bare`, plus an optional `locked`.
 * The block whose path is the current tab's top-level is flagged `isCurrent`.
 */
async function readWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  // `core.quotePath=false` keeps non-ASCII bytes in paths and the lock reason raw
  // (UTF-8) instead of C-quoting them (e.g. "á" → \303\241), which would show up
  // mangled in the UI.
  const out = await runGit(cwd, [
    '-c',
    'core.quotePath=false',
    'worktree',
    'list',
    '--porcelain',
  ]);
  if (!out.trim()) return [];
  const current = normalizePath((await runGit(cwd, ['rev-parse', '--show-toplevel'])).trim());
  const trees: WorktreeInfo[] = [];
  for (const block of out.split(/\n{2,}/)) {
    let treePath = '';
    let head = '';
    let branch: string | undefined;
    let bare = false;
    let locked = false;
    let lockReason: string | undefined;
    for (const line of nonEmptyLines(block)) {
      if (line.startsWith('worktree ')) treePath = line.slice('worktree '.length);
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).slice(0, 7);
      else if (line.startsWith('branch '))
        branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      else if (line === 'bare') bare = true;
      else if (line === 'locked' || line.startsWith('locked ')) {
        locked = true;
        // A reason, when given, follows on the same line: "locked <reason>".
        const reason = line.slice('locked'.length).trim();
        if (reason) lockReason = reason;
      }
    }
    if (!treePath) continue;
    trees.push({
      path: treePath,
      head,
      branch,
      bare,
      locked,
      lockReason,
      // Porcelain lists the primary worktree first.
      isMain: trees.length === 0,
      isCurrent: normalizePath(treePath) === current,
    });
  }
  return trees;
}

/**
 * Whether `cwd` is a *linked* worktree rather than the repository's main one.
 * A linked worktree's per-worktree git dir (`.git/worktrees/<name>`) differs from
 * the shared common dir (`.git`); for the main worktree the two are the same.
 * (A submodule's two dirs also coincide, so this doesn't false-positive on one.)
 */
async function isLinkedWorktree(cwd: string): Promise<boolean> {
  const gitDir = (await runGit(cwd, ['rev-parse', '--git-dir'])).trim();
  const commonDir = (await runGit(cwd, ['rev-parse', '--git-common-dir'])).trim();
  if (!gitDir || !commonDir) return false;
  // Both can come back relative to cwd; resolve before comparing.
  return normalizePath(path.resolve(cwd, gitDir)) !== normalizePath(path.resolve(cwd, commonDir));
}

async function readRefs(cwd: string): Promise<RepoRefs> {
  const [localBranches, remoteBranches, remotes, tags, stashes, worktrees] = await Promise.all([
    readLocalBranches(cwd),
    readRemoteBranches(cwd),
    readRemotes(cwd),
    readTags(cwd),
    readStashes(cwd),
    readWorktrees(cwd),
  ]);
  return { localBranches, remoteBranches, remotes, tags, stashes, worktrees };
}

/**
 * If a failed git child was aborted by a repository hook, describe it in one
 * line; otherwise null. Any hook can stop an operation (pre-commit, commit-msg,
 * prepare-commit-msg, pre-rebase, pre-merge-commit, post-checkout, pre-push, …),
 * and its own diagnostic output was already streamed to the activity log, so
 * point the user there rather than at git's last line (which for a hook abort is
 * usually a misleading generic error). Detection stays generic — we match git's
 * own hook-abort phrasing, never any specific hook runner's output.
 */
function hookFailureMessage(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const rec = err as Record<string, unknown>;
  const text = `${String(rec.stderr ?? '')}\n${String(rec.stdout ?? '')}`;
  const match = text.match(/\b([a-z][a-z-]*) hook (?:failed|declined|exited)/i);
  if (match) return `The ${match[1]} hook failed — see the activity log.`;
  if (/hook declined|hook returned non-zero/i.test(text)) {
    return 'A git hook failed — see the activity log.';
  }
  return null;
}

/**
 * True when the repo has an executable hook among `names`. A pre-commit /
 * commit-msg hook aborts a commit with only its *own* output — git adds no line
 * of its own (unlike pre-push, which git names) — so we can't recognise the
 * abort from stderr. Presence of an enabled hook is the signal instead; the
 * hook's output has already streamed to the activity log, so callers can point
 * the user there rather than surfacing raw hook noise in a toast.
 */
async function hasEnabledHook(cwd: string, names: string[]): Promise<boolean> {
  const rel = (await runGit(cwd, ['rev-parse', '--git-path', 'hooks'])).trim();
  if (!rel) return false;
  const hooksDir = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
  for (const name of names) {
    try {
      await fs.promises.access(path.join(hooksDir, name), fs.constants.X_OK);
      return true;
    } catch {
      // Missing or non-executable — try the next candidate.
    }
  }
  return false;
}

/**
 * True when a failed git child spoke in git's *own* voice (a `fatal:`/`error:`
 * line or the well-known empty-commit phrasing) rather than leaving only a
 * hook's output. Lets a commit distinguish "git rejected this" (show the
 * message) from "a hook rejected this" (point at the activity log).
 */
function looksLikeNativeGitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rec = err as Record<string, unknown>;
  const text = `${String(rec.stderr ?? '')}\n${String(rec.stdout ?? '')}`;
  return (
    /^\s*(fatal|error):/im.test(text) ||
    /nothing to commit|no changes added to commit|working tree clean|changes not staged/i.test(text)
  );
}

/**
 * Strip ANSI escape sequences (SGR colors, cursor moves) from text. Hook runners
 * like Pest emit richly-colored output; the raw escapes are noise in a toast.
 */
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

/**
 * Path of the file holding a repo's unsent commit-message draft, or '' when the
 * git dir can't be resolved. It lives in the git dir (like git's own
 * `COMMIT_EDITMSG`) rather than the work tree, so a saved draft never shows up
 * as an untracked change.
 */
async function commitDraftFile(repoPath: string): Promise<string> {
  const gitDir = (await runGit(repoPath, ['rev-parse', '--absolute-git-dir'])).trim();
  return gitDir ? path.join(gitDir, 'GITLEVIATHAN_MSG') : '';
}

/** Pull a concise message out of a failed git exec (its last stderr line). */
function gitErrorMessage(err: unknown, fallback: string): string {
  const hook = hookFailureMessage(err);
  if (hook) return hook;
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = stripAnsi(String((err as { stderr: unknown }).stderr ?? '')).trim();
    const lines = stderr.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length > 0) return lines[lines.length - 1];
  }
  return fallback;
}

const GITFLOW_KINDS: GitflowKind[] = ['feature', 'release', 'hotfix'];

/** Fallback gitflow config for a repo that hasn't been configured. */
const GITFLOW_DEFAULTS: GitflowConfig = {
  mainBranch: 'main',
  developBranch: 'develop',
  featurePrefix: 'feature/',
  releasePrefix: 'release/',
  hotfixPrefix: 'hotfix/',
};

/** The git config key backing each `GitflowConfig` field. */
const GITFLOW_CONFIG_KEYS: Record<keyof GitflowConfig, string> = {
  mainBranch: 'gitflow.branch.master',
  developBranch: 'gitflow.branch.develop',
  featurePrefix: 'gitflow.prefix.feature',
  releasePrefix: 'gitflow.prefix.release',
  hotfixPrefix: 'gitflow.prefix.hotfix',
};

/**
 * Read the repo's gitflow config from its git config. Returns `null` when the
 * repo isn't configured (no `gitflow.branch.develop`); otherwise fills any empty
 * key from `GITFLOW_DEFAULTS` so callers always get a complete config.
 */
async function readGitflowConfig(cwd: string): Promise<GitflowConfig | null> {
  const read = async (key: string) =>
    (await runGit(cwd, ['config', '--get', key])).trim();
  const developBranch = await read(GITFLOW_CONFIG_KEYS.developBranch);
  if (!developBranch) return null;
  const [mainBranch, featurePrefix, releasePrefix, hotfixPrefix] = await Promise.all([
    read(GITFLOW_CONFIG_KEYS.mainBranch),
    read(GITFLOW_CONFIG_KEYS.featurePrefix),
    read(GITFLOW_CONFIG_KEYS.releasePrefix),
    read(GITFLOW_CONFIG_KEYS.hotfixPrefix),
  ]);
  return {
    mainBranch: mainBranch || GITFLOW_DEFAULTS.mainBranch,
    developBranch,
    featurePrefix: featurePrefix || GITFLOW_DEFAULTS.featurePrefix,
    releasePrefix: releasePrefix || GITFLOW_DEFAULTS.releasePrefix,
    hotfixPrefix: hotfixPrefix || GITFLOW_DEFAULTS.hotfixPrefix,
  };
}

/** The configured topic-branch prefix for a gitflow kind. */
function gitflowPrefix(config: GitflowConfig, kind: GitflowKind): string {
  return kind === 'feature'
    ? config.featurePrefix
    : kind === 'release'
      ? config.releasePrefix
      : config.hotfixPrefix;
}

/** The base branch a gitflow kind branches off / finishes into. */
function gitflowBase(config: GitflowConfig, kind: GitflowKind): string {
  return kind === 'hotfix' ? config.mainBranch : config.developBranch;
}

/** Which gitflow kind `branch` belongs to by its configured prefix, or null. */
function gitflowKindOf(config: GitflowConfig, branch: string): GitflowKind | null {
  return GITFLOW_KINDS.find((kind) => branch.startsWith(gitflowPrefix(config, kind))) ?? null;
}

/**
 * Validate one gitflow config value bound for git config. Values are ref/prefix
 * fragments, so keep them to a safe slug (letters, digits, `._/-`) that can't
 * inject flags or shell metacharacters — the same guard used for topic names.
 */
function isGitflowValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('-') &&
    /^[A-Za-z0-9._/-]+$/.test(value)
  );
}

const PULL_MODES: PullMode[] = ['ff', 'ff-only', 'rebase', 'fetch-all'];

/**
 * Run a sequence of git commands in `cwd`, stopping at the first failure, then
 * resolve with the repo's fresh refs (or a friendly error message on failure).
 */
async function mutateRepo(
  cwd: string,
  steps: string[][],
  fallback: string,
): Promise<RefsMutationResult> {
  const env = gitEnv({ GIT_TERMINAL_PROMPT: '0' });
  try {
    for (const args of steps) {
      await spawnGit(cwd, args, activityOp(args), env);
    }
  } catch (err) {
    return { status: 'error', message: gitErrorMessage(err, fallback) };
  }
  return { status: 'ok', refs: await readRefs(cwd) };
}

// --- Live activity stream ---------------------------------------------------
//
// Mutating git commands run through `spawnGit` instead of `execFileAsync` so
// their output — crucially, the output of repository hooks like a `pre-commit`
// test run — can be streamed to a footer activity log line by line while the
// command is still running, rather than buffered and thrown away on success.

/** Buffered result of a git run, mirroring `execFileAsync`'s resolve shape. */
interface GitRun {
  stdout: string;
  stderr: string;
}

/** Broadcast one activity event to every open window (renderers filter by repo). */
function emitActivity(event: RepoActivityEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(RepoChannels.activity, event);
  }
}

/**
 * A short activity label for a git step: its subcommand, skipping any leading
 * global options (`-c key=val`, `-C dir`) and their values so an auth-injecting
 * `-c http.…extraheader=…` prefix doesn't mask the real verb (`push`).
 */
function activityOp(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-c' || arg === '-C') {
      i++; // skip this flag's value too
      continue;
    }
    if (arg.startsWith('-')) continue;
    return arg;
  }
  return 'git';
}

/** Strip inline URL credentials and any injected auth header from a log line. */
function redactActivity(text: string): string {
  return redactSecrets(text, null).replace(
    /Authorization: Basic \S+/gi,
    'Authorization: Basic ***',
  );
}

/**
 * Run a mutating git command via `spawn`, streaming its stdout/stderr to the
 * renderer's activity log line by line as it arrives, while still behaving like
 * `execFileAsync`: resolves with the buffered `{ stdout, stderr }` on a clean
 * exit and rejects with an execFile-shaped error (carrying `stdout`, `stderr`,
 * `code`) otherwise, so `gitErrorMessage`/`pushErrorMessage`/`pullErrorMessage`
 * keep working unchanged. `op` is the short label shown in the footer.
 */
function spawnGit(
  cwd: string,
  args: string[],
  op: string,
  env: NodeJS.ProcessEnv = gitEnv({ GIT_TERMINAL_PROMPT: '0' }),
): Promise<GitRun> {
  return new Promise((resolve, reject) => {
    emitActivity({ repoPath: cwd, op, kind: 'start', ts: Date.now() });
    const child = spawn(gitBin, args, { cwd, env });
    let stdout = '';
    let stderr = '';
    // Carry the tail of a chunk that didn't end on a newline into the next one,
    // so a line split across chunks is emitted once, whole.
    const partial: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
    const pump = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const text = chunk.toString();
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      const lines = (partial[stream] + text).split('\n');
      partial[stream] = lines.pop() ?? '';
      for (const line of lines) {
        emitActivity({ repoPath: cwd, op, kind: 'line', stream, text: redactActivity(line), ts: Date.now() });
      }
    };
    child.stdout?.on('data', pump('stdout'));
    child.stderr?.on('data', pump('stderr'));
    // Emit any unterminated trailing text (git often ends without a newline).
    const flush = () => {
      for (const stream of ['stdout', 'stderr'] as const) {
        if (partial[stream]) {
          emitActivity({ repoPath: cwd, op, kind: 'line', stream, text: redactActivity(partial[stream]), ts: Date.now() });
          partial[stream] = '';
        }
      }
    };
    child.on('error', (err) => {
      flush();
      emitActivity({ repoPath: cwd, op, kind: 'end', ok: false, ts: Date.now() });
      reject(err);
    });
    child.on('close', (code) => {
      flush();
      emitActivity({ repoPath: cwd, op, kind: 'end', ok: code === 0, exitCode: code ?? undefined, ts: Date.now() });
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const err = new Error(`git ${op} exited with code ${code ?? 'null'}`) as Error & {
        stdout: string;
        stderr: string;
        code: number | null;
      };
      err.stdout = stdout;
      err.stderr = stderr;
      err.code = code;
      reject(err);
    });
  });
}

// --- Undo / redo over the HEAD reflog ---------------------------------------
//
// Undo/redo is modelled as travel along the HEAD reflog: each entry is a past
// position of HEAD, and "the last action" is the move that landed on the
// current one. A `RepoHistory` is seeded from the reflog on first use and then
// self-managed in memory so successive undos/redos don't fight the extra reflog
// entries our own resets create. It's rebuilt from the reflog whenever HEAD has
// moved by something other than our own undo/redo (a fresh action), which also
// discards the now-stale redo future.

/**
 * How to move HEAD for one undo/redo hop. A `checkout` switches refs back; a
 * `reset` moves the branch, in one of two modes:
 * - `mixed` — leave the working tree alone so the diff resurfaces as *unstaged*
 *   changes (how undoing a plain commit should feel: the commit is gone but its
 *   edits come back to work on). Never clobbers the working tree.
 * - `keep`  — reset tracked files to the target while preserving unrelated local
 *   edits, refusing if they'd be overwritten. Used for merge/rebase/reset/etc.,
 *   where the point is to drop the changes, not re-surface them.
 */
type TravelStep =
  | { kind: 'checkout'; target: string }
  | { kind: 'reset'; target: string; mode: 'keep' | 'mixed' };

/** One reversible step: how to travel when undoing it, and when redoing it. */
interface UndoMove {
  /** Short human label of the action this step undoes/redoes (for the tooltip). */
  label: string;
  undo: TravelStep;
  redo: TravelStep;
}

interface RepoHistory {
  /** Undoable moves, most-recent first (`past[0]` is the next undo). */
  past: UndoMove[];
  /** Redoable moves, most-recent first (`future[0]` is the next redo). */
  future: UndoMove[];
  /** The HEAD hash we last left the repo at; a mismatch means a foreign action. */
  expectedHead: string;
}

const undoHistories = new Map<string, RepoHistory>();

/** The current HEAD commit hash, or '' when it can't be resolved (empty repo). */
async function headHash(cwd: string): Promise<string> {
  return (await runGit(cwd, ['rev-parse', 'HEAD'])).trim();
}

/** Condense a reflog subject into a short, readable action label. */
function humanizeReflog(subject: string): string {
  const checkout = /^checkout: moving from (.+?) to (.+)$/.exec(subject);
  if (checkout) return `checkout: ${checkout[1]} → ${checkout[2]}`;
  const commit = /^commit(?: \((amend|initial|merge)\))?: (.+)$/.exec(subject);
  if (commit) return `commit${commit[1] ? ` (${commit[1]})` : ''}: ${commit[2]}`;
  // merge/rebase/pull/reset/revert/cherry-pick: keep the leading clause only.
  const colon = subject.indexOf(':');
  if (colon !== -1) {
    const head = subject.slice(0, colon).trim();
    if (/^(merge|rebase|pull|reset|revert|cherry-pick)\b/i.test(head)) return head;
  }
  return subject;
}

/**
 * Build the undo stack from the HEAD reflog (newest first). Reflog entry `i`
 * moved HEAD from position `i+1` to position `i`; undoing it returns to `i+1`
 * (a checkout is reversed by checking the previous ref back out).
 */
async function buildUndoStack(cwd: string): Promise<UndoMove[]> {
  const out = await runGit(cwd, ['reflog', '--format=%H%x1f%gs', '-n', '100']);
  const positions = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject = ''] = line.split('\x1f');
      return { hash, subject };
    });
  const moves: UndoMove[] = [];
  for (let i = 0; i < positions.length - 1; i++) {
    const cur = positions[i];
    const prev = positions[i + 1];
    const checkout = /^checkout: moving from (.+?) to (.+)$/.exec(cur.subject);
    if (checkout) {
      moves.push({
        label: humanizeReflog(cur.subject),
        undo: { kind: 'checkout', target: checkout[1] },
        redo: { kind: 'checkout', target: checkout[2] },
      });
    } else {
      // Undoing a plain commit should hand its edits back as unstaged changes
      // (`--mixed`); undoing a merge/rebase/reset/pull just rewinds HEAD without
      // dumping the integrated diff into the working tree (`--keep`).
      const mode: 'keep' | 'mixed' = /^commit(?: \(initial\))?: /.test(cur.subject)
        ? 'mixed'
        : 'keep';
      moves.push({
        label: humanizeReflog(cur.subject),
        undo: { kind: 'reset', target: prev.hash, mode },
        redo: { kind: 'reset', target: cur.hash, mode },
      });
    }
  }
  return moves;
}

/**
 * The repo's undo history, reseeded from the reflog when HEAD has moved by
 * something other than our own undo/redo (which invalidates any redo future).
 */
async function ensureHistory(cwd: string): Promise<RepoHistory> {
  const head = await headHash(cwd);
  const existing = undoHistories.get(cwd);
  if (existing && existing.expectedHead === head) return existing;
  const fresh: RepoHistory = {
    past: await buildUndoStack(cwd),
    future: [],
    expectedHead: head,
  };
  undoHistories.set(cwd, fresh);
  return fresh;
}

/**
 * Move HEAD one undo/redo step: a safe `git reset --keep` (keeps uncommitted
 * work, refuses when it would clobber it) or a `git checkout` back. Distinct
 * from `mutateRepo` only to translate git's terse "would overwrite" complaint.
 */
async function travelHistory(
  cwd: string,
  step: TravelStep,
): Promise<RefsMutationResult> {
  const env = gitEnv({ GIT_TERMINAL_PROMPT: '0' });
  const args =
    step.kind === 'checkout'
      ? ['checkout', step.target]
      : ['reset', step.mode === 'mixed' ? '--mixed' : '--keep', step.target];
  try {
    await spawnGit(cwd, args, activityOp(args), env);
  } catch (err) {
    const stderr =
      err && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr: unknown }).stderr ?? '')
        : '';
    if (/not uptodate|overwritten|would be overwritten|cannot merge/i.test(stderr)) {
      return {
        status: 'error',
        message: 'Commit or stash your changes first — this would overwrite them.',
      };
    }
    return { status: 'error', message: gitErrorMessage(err, 'Could not complete the undo.') };
  }
  return { status: 'ok', refs: await readRefs(cwd) };
}

/**
 * Integrate `source` into `target` by checking out `target` and running
 * `git <op> source` (merge or rebase). We let git decide the shape: a merge
 * fast-forwards when it can and makes a merge commit when the branches diverged.
 * When the operation was a no-op — `target` already contained `source` — git
 * prints an "up to date" line; we detect it and return a `notice` so the UI can
 * tell the user nothing changed instead of silently reloading.
 */
async function integrateBranch(
  cwd: string,
  target: string,
  source: string,
  op: 'merge' | 'rebase',
  fallback: string,
): Promise<RefsMutationResult> {
  const env = gitEnv({ GIT_TERMINAL_PROMPT: '0' });
  let output = '';
  try {
    await spawnGit(cwd, ['checkout', target], 'checkout', env);
    const result = await spawnGit(cwd, [op, source], op, env);
    output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  } catch (err) {
    return { status: 'error', message: gitErrorMessage(err, fallback) };
  }
  const refs = await readRefs(cwd);
  // `git merge` → "Already up to date."; `git rebase` → "…is up to date."
  const noOp = /already up to date|is up to date/i.test(output);
  return noOp
    ? { status: 'ok', refs, notice: `“${target}” is already up to date with “${source}”.` }
    : { status: 'ok', refs };
}

/** The configured remote names (`origin`, …), for classifying decorations. */
/**
 * Parse git's %D decoration string into structured refs. `remotes` is the set of
 * configured remote names: a token is a remote-tracking ref only when its first
 * path segment names an actual remote (`origin/…`). A slash alone doesn't imply
 * a remote — local branches use slashes too (`feature/x`, `refactor/x`).
 */
function parseDecorations(raw: string, remotes: Set<string>): CommitRefDecoration[] {
  return raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    // Drop symbolic "origin/HEAD" style pointers — they're noise, not a branch.
    .filter((token) => !token.endsWith('/HEAD'))
    .map((token): CommitRefDecoration => {
      if (token.startsWith('HEAD -> ')) {
        return { kind: 'head', label: token.slice('HEAD -> '.length) };
      }
      if (token === 'HEAD') return { kind: 'head', label: 'HEAD' };
      if (token.startsWith('tag: ')) {
        return { kind: 'tag', label: token.slice('tag: '.length) };
      }
      const slash = token.indexOf('/');
      if (slash !== -1 && remotes.has(token.slice(0, slash))) {
        return { kind: 'remote', label: token };
      }
      return { kind: 'branch', label: token };
    });
}

// Field/record separators unlikely to appear in commit metadata.
const LOG_FS = '\x1f';
const LOG_FORMAT = ['%H', '%h', '%P', '%an', '%ae', '%aI', '%s', '%D'].join(LOG_FS);
const DEFAULT_LOG_LIMIT = 2000;

/**
 * Gravatar URL for an email, with a per-address `identicon` so authors without
 * a Gravatar still get a stable, unique image for the commit-graph node.
 */
function gravatarUrl(email: string): string {
  const hash = createHash('md5')
    .update(email.trim().toLowerCase())
    .digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=48&d=identicon`;
}

/**
 * Lowercased author email → the GitHub identity resolved for it via the API.
 * Filled lazily in the background when a connected GitHub repo's log is read
 * (see enrichGithubAvatars) and persisted across sessions, so it covers authors
 * whose real/private commit email the offline noreply heuristic can't map.
 */
const githubAvatars = new Map<string, { avatarUrl: string; login: string }>();

/**
 * A GitHub author's real avatar derived purely from their commit email, or
 * `null` when the email doesn't identify a GitHub user. GitHub has no public
 * email→avatar endpoint, but its default private-commit emails encode the
 * identity directly: `12345+user@users.noreply.github.com` gives the numeric
 * user id (→ avatars.githubusercontent.com/u/12345), and the legacy
 * `user@users.noreply.github.com` gives the login (→ github.com/user.png).
 * Authors who commit with a real/private email can't be resolved this way and
 * fall back to Gravatar.
 */
function githubAvatarUrl(email: string): string | null {
  const match = /^(?:(\d+)\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/i.exec(
    email.trim(),
  );
  if (!match) return null;
  const [, id, login] = match;
  return id
    ? `https://avatars.githubusercontent.com/u/${id}?v=4&s=48`
    : `https://github.com/${encodeURIComponent(login)}.png?size=48`;
}

/**
 * Avatar for a commit author's email. In a GitHub repo, prefer the author's real
 * GitHub avatar — first from the API-resolved cache (covers real/private emails),
 * then the noreply-email heuristic (works offline) — and otherwise fall back to a
 * Gravatar identicon.
 */
function avatarUrl(email: string, isGithubRepo: boolean): string {
  if (isGithubRepo) {
    const cached = githubAvatars.get(email.trim().toLowerCase());
    if (cached) return cached.avatarUrl;
    const derived = githubAvatarUrl(email);
    if (derived) return derived;
  }
  return gravatarUrl(email);
}

const githubAvatarsPath = () =>
  path.join(app.getPath('userData'), 'github-avatars.json');

/** Load the persisted email → GitHub-identity cache into memory (once, at boot). */
function loadGithubAvatars(): void {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(githubAvatarsPath(), 'utf-8'),
    ) as unknown;
    if (!parsed || typeof parsed !== 'object') return;
    for (const [email, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        value &&
        typeof value === 'object' &&
        typeof (value as { avatarUrl?: unknown }).avatarUrl === 'string' &&
        typeof (value as { login?: unknown }).login === 'string'
      ) {
        const entry = value as { avatarUrl: string; login: string };
        githubAvatars.set(email, { avatarUrl: entry.avatarUrl, login: entry.login });
      }
    }
  } catch {
    // No cache yet, or the file is unreadable — start empty.
  }
}

let saveGithubAvatarsTimer: NodeJS.Timeout | null = null;
/** Persist the avatar cache, debounced so a burst of resolutions writes once. */
function saveGithubAvatars(): void {
  if (saveGithubAvatarsTimer) return;
  saveGithubAvatarsTimer = setTimeout(() => {
    saveGithubAvatarsTimer = null;
    try {
      fs.writeFileSync(
        githubAvatarsPath(),
        JSON.stringify(Object.fromEntries(githubAvatars)),
        'utf-8',
      );
    } catch (err) {
      console.error('Failed to persist the GitHub avatar cache:', err);
    }
  }, 1000);
}

/** Repos with an avatar crawl in flight, so overlapping log loads don't stack. */
const avatarCrawlsInFlight = new Set<string>();
/**
 * Emails a crawl already tried but couldn't resolve, so a re-sync doesn't crawl
 * for them again. Session-only: they may have no GitHub account, or live only on
 * a branch the default-branch walk doesn't reach — a fresh launch retries in
 * case the author has since made their email public.
 */
const triedUnresolvedEmails = new Set<string>();

/**
 * Best-effort background fill of the GitHub avatar cache for a connected GitHub
 * repo. Emails already cached, already tried, or resolvable offline (noreply) are
 * skipped; the rest drive a bounded crawl of the repo's commits, where GitHub
 * maps each author email to an account server-side. When new avatars are learned
 * they're cached, persisted, and every window is told the repo changed so its
 * graph re-reads the log and the identicons upgrade to real avatars in place.
 */
async function enrichGithubAvatars(
  repoPath: string,
  commits: CommitLogEntry[],
): Promise<void> {
  if (avatarCrawlsInFlight.has(repoPath)) return;

  const wanted = new Set<string>();
  for (const commit of commits) {
    const email = commit.authorEmail?.trim().toLowerCase();
    if (!email) continue;
    if (githubAvatars.has(email) || triedUnresolvedEmails.has(email)) continue;
    // A noreply email already resolves offline, so it doesn't need an API call.
    if (githubAvatarUrl(commit.authorEmail)) continue;
    wanted.add(email);
  }
  if (wanted.size === 0) return;

  const token = getToken('github');
  if (!token) return;

  const host = (await readRemotes(repoPath))
    .map((remote) => parseRepoHost(remote.url))
    .find((h): h is RepoHost => h?.provider === 'github');
  if (!host) return;

  avatarCrawlsInFlight.add(repoPath);
  try {
    const resolved = await github.fetchCommitAuthors(token, host.owner, host.repo, {
      // Stop paging as soon as every email we're after has been resolved.
      stop: (found) => [...wanted].every((email) => found.has(email)),
    });
    let added = false;
    for (const [email, identity] of resolved) {
      if (!githubAvatars.has(email)) {
        githubAvatars.set(email, {
          avatarUrl: identity.avatarUrl,
          login: identity.login,
        });
        added = true;
      }
    }
    // Whatever the crawl couldn't resolve, don't chase again this session.
    for (const email of wanted) {
      if (!githubAvatars.has(email)) triedUnresolvedEmails.add(email);
    }
    if (added) {
      saveGithubAvatars();
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(RepoChannels.changed, repoPath);
      }
    }
  } catch {
    // Rate limited, offline, or no access (e.g. a private repo the token can't
    // read) — leave the identicons in place rather than surfacing an error.
  } finally {
    avatarCrawlsInFlight.delete(repoPath);
  }
}

async function readLogCommits(
  cwd: string,
  limit: number,
  remotes: Set<string>,
  isGithubRepo: boolean,
): Promise<CommitLogEntry[]> {
  // --date-order lists commits newest-first by commit date while still never
  // showing a parent before its children — the only ordering the renderer's lane
  // layout relies on. (--topo-order also satisfies that, but walks one lineage
  // fully before switching to a sibling, so merged branches make the dates jump
  // backwards and forwards; --date-order interleaves them to stay chronological.)
  // --all walks every ref (all branches, tags and remotes) rather than just
  // HEAD's history, so the graph shows every branch and each branch's tip commit
  // is present to be selected. --exclude=refs/stash (which must precede --all)
  // keeps the stash out of this walk: a stash is a merge commit and --all would
  // otherwise pull in both the stash tip and its synthetic "index on …" parent.
  // Stashes are woven in separately, once each, by readStashCommits/mergeStashes.
  const out = await runGit(cwd, [
    'log',
    '--exclude=refs/stash',
    '--all',
    '--date-order',
    `--max-count=${limit}`,
    `--pretty=format:${LOG_FORMAT}`,
  ]);
  return nonEmptyLines(out).map((line) => {
    const [
      hash,
      shortHash,
      parents,
      author,
      authorEmail,
      date,
      subject,
      decorations = '',
    ] = line.split(LOG_FS);
    return {
      hash,
      shortHash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author,
      authorEmail,
      authorAvatarUrl: avatarUrl(authorEmail, isGithubRepo),
      date,
      subject,
      refs: parseDecorations(decorations, remotes),
    };
  });
}

/**
 * Read local stashes as commit entries. A stash is a commit whose first parent
 * is the commit it was taken from; we keep only that first parent (dropping the
 * synthetic index/untracked parents) so the graph draws one clean line from the
 * stash down to its base. Stashes are ordered `stash@{0}` first, so the array
 * index is the stash index.
 */
async function readStashCommits(
  cwd: string,
  isGithubRepo: boolean,
): Promise<CommitLogEntry[]> {
  const out = await runGit(cwd, ['stash', 'list', `--format=${LOG_FORMAT}`]);
  return nonEmptyLines(out).map((line, index) => {
    const [hash, shortHash, parents, author, authorEmail, date, subject] =
      line.split(LOG_FS);
    const base = parents ? parents.split(' ').filter(Boolean)[0] : undefined;
    return {
      hash,
      shortHash,
      parents: base ? [base] : [],
      author,
      authorEmail,
      authorAvatarUrl: avatarUrl(authorEmail, isGithubRepo),
      date,
      // Drop the "WIP on <branch>:" / "On <branch>:" noise so the graph row reads
      // as the message alone (matching how the stash list renders it).
      subject: parseStashSubject(subject).message,
      refs: [],
      stashIndex: index,
    };
  });
}

/**
 * Weave stash entries into a topo-ordered commit list. Each stash is a tip
 * (nothing points at it), so it can sit anywhere before its base commit; we
 * splice it in immediately above that base, which keeps topo order valid and
 * places the dotted connector right next to where the stash branched. When the
 * base isn't within this page, the stash is shown standalone at the top.
 */
function mergeStashes(
  commits: CommitLogEntry[],
  stashes: CommitLogEntry[],
): CommitLogEntry[] {
  if (stashes.length === 0) return commits;
  const result = commits.slice();
  for (const stash of stashes) {
    const base = stash.parents[0];
    const at = base ? result.findIndex((commit) => commit.hash === base) : -1;
    if (at === -1) result.unshift({ ...stash, parents: [] });
    else result.splice(at, 0, stash);
  }
  return result;
}

async function readLog(cwd: string, limit: number): Promise<CommitLogEntry[]> {
  // Read remotes once up front: their names drive %D decoration parsing, and
  // whether any points at github.com decides if author avatars can come from
  // GitHub (see avatarUrl) rather than Gravatar.
  const remoteInfos = await readRemotes(cwd);
  const remoteNames = new Set(remoteInfos.map((remote) => remote.name));
  const isGithubRepo = remoteInfos.some(
    (remote) => parseRepoHost(remote.url)?.provider === 'github',
  );
  const [commits, stashes] = await Promise.all([
    readLogCommits(cwd, limit, remoteNames, isGithubRepo),
    readStashCommits(cwd, isGithubRepo),
  ]);
  return mergeStashes(commits, stashes);
}

function mapFileStatus(code: string): FileStatus {
  switch (code) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    default:
      // M, C, T, and anything else fall back to "modified".
      return 'modified';
  }
}

async function readCommitFiles(cwd: string, hash: string): Promise<FileChange[]> {
  // A stash (like any merge) has multiple parents, and `diff-tree` emits nothing
  // for a merge by default — so it would list no files. Detect that case and diff
  // the commit against its first parent instead, matching `git stash show` (the
  // tracked changes it captured). `runGitDiff` is required because `git diff`
  // signals differences with a non-zero exit that `runGit` would discard.
  const parents = (await runGit(cwd, ['rev-list', '--parents', '-n', '1', hash]))
    .trim()
    .split(/\s+/)
    .slice(1);
  const out =
    parents.length > 1
      ? await runGitDiff(cwd, ['diff', '--name-status', '-r', `${hash}^1`, hash])
      : // Diff a commit against its first parent; --root makes the initial commit
        // list all its files as added. --name-status yields "M\tpath".
        await runGit(cwd, [
          'diff-tree',
          '--no-commit-id',
          '--name-status',
          '-r',
          '--root',
          hash,
        ]);
  return nonEmptyLines(out).flatMap((line) => {
    const parts = line.split('\t');
    if (parts.length < 2) return [];
    // For renames/copies the new path is the last field.
    const path = parts[parts.length - 1];
    return [{ path, status: mapFileStatus(parts[0][0] ?? '') }];
  });
}

/**
 * List every file in a commit's tree — the full repository snapshot as of that
 * commit. `ls-tree -r --name-only` walks the whole tree and prints one path per
 * blob (no directories).
 */
async function readCommitTree(cwd: string, hash: string): Promise<string[]> {
  const out = await runGit(cwd, ['ls-tree', '-r', '--name-only', hash]);
  return nonEmptyLines(out);
}

/**
 * Parse a unified diff (git's `-p` output) into per-line rows for the viewer.
 * Header lines (`diff --git`, `index`, `---`, `+++`) are dropped; each `@@` hunk
 * header becomes a `hunk` row and resets the running old/new line counters that
 * subsequent context/add/delete rows are numbered from.
 */
function parseUnifiedDiff(patch: string): { binary: boolean; lines: DiffLine[] } {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let binary = false;
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
        inHunk = true;
        lines.push({ kind: 'hunk', oldLine: null, newLine: null, text: raw });
      }
      continue;
    }
    if (!inHunk) {
      // Pre-hunk header lines are skipped, but note a binary marker so the viewer
      // can say so instead of showing an empty diff.
      if (raw.startsWith('Binary files') || raw.startsWith('GIT binary patch')) {
        binary = true;
      }
      continue;
    }
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === '+') {
      lines.push({ kind: 'add', oldLine: null, newLine, text });
      newLine++;
    } else if (marker === '-') {
      lines.push({ kind: 'delete', oldLine, newLine: null, text });
      oldLine++;
    } else if (marker === ' ') {
      lines.push({ kind: 'context', oldLine, newLine, text });
      oldLine++;
      newLine++;
    }
    // A "\ No newline at end of file" marker (and the trailing empty split entry)
    // fall through and are ignored.
  }
  return { binary, lines };
}

/** The git args that emit `file`'s unified diff for a given diff source. */
function fileDiffArgs(source: DiffSource, file: string): string[] {
  switch (source.kind) {
    case 'commit':
      // `show --format=` prints just the patch; --root lists the initial commit's
      // files as additions. -M detects renames. --first-parent makes a merge (e.g.
      // a stash) show as a plain diff against its first parent instead of an empty
      // combined diff; it's a no-op for ordinary single-parent commits.
      return [
        'show',
        '--no-color',
        '--format=',
        '-M',
        '--first-parent',
        source.hash,
        '--',
        file,
      ];
    case 'staged':
      return ['diff', '--no-color', '-M', '--cached', '--', file];
    case 'unstaged':
      return ['diff', '--no-color', '-M', '--', file];
  }
}

/**
 * Like `runGit`, but preserves stdout when git exits non-zero. `git diff` uses
 * exit code 1 to signal "there are differences", which `execFile` treats as an
 * error — so the patch would otherwise be thrown away.
 */
async function runGitDiff(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(gitBin, args, {
      cwd,
      env: gitEnv({ GIT_TERMINAL_PROMPT: '0' }),
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const out = (err as { stdout?: string }).stdout;
    return typeof out === 'string' ? out : '';
  }
}

/** Whether `file` is untracked (present on disk but not known to git). */
async function isUntracked(cwd: string, file: string): Promise<boolean> {
  const out = await runGit(cwd, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    file,
  ]);
  return out.trim().length > 0;
}

/**
 * The raw unified-diff text for `file`'s unstaged changes — the same patch the
 * viewer parses, so hunk indices line up between display and hunk staging. An
 * untracked file isn't part of git's diff (it prints nothing), so it's diffed
 * against an empty file, matching how it renders once `git add`ed.
 */
async function rawUnstagedDiff(cwd: string, file: string): Promise<string> {
  const out = await runGit(cwd, fileDiffArgs({ kind: 'unstaged' }, file));
  if (out === '' && (await isUntracked(cwd, file))) {
    return runGitDiff(cwd, ['diff', '--no-color', '--no-index', '--', '/dev/null', file]);
  }
  return out;
}

async function readFileDiff(
  cwd: string,
  source: DiffSource,
  file: string,
): Promise<FileDiff> {
  const out =
    source.kind === 'unstaged'
      ? await rawUnstagedDiff(cwd, file)
      : await runGit(cwd, fileDiffArgs(source, file));
  const { binary, lines } = parseUnifiedDiff(out);
  return { path: file, binary, lines };
}

/**
 * Carve a single-hunk patch out of a file's full unified diff `patch`: the file
 * header (every line before the first `@@`) plus only the `hunkIndex`-th (0-based)
 * `@@ … @@` hunk. `git apply` can then stage/revert just that hunk. Returns null
 * when the patch has no header or the index is out of range.
 */
function extractHunkPatch(patch: string, hunkIndex: number): string | null {
  const lines = patch.split('\n');
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
  if (firstHunk === -1) return null;
  const header = lines.slice(0, firstHunk);
  const hunks: string[][] = [];
  for (const line of lines.slice(firstHunk)) {
    // Each `@@` opens a hunk; every following line (context/+/-/"\ No newline")
    // belongs to it until the next `@@`.
    if (line.startsWith('@@')) hunks.push([line]);
    else hunks[hunks.length - 1]?.push(line);
  }
  if (hunkIndex < 0 || hunkIndex >= hunks.length) return null;
  // git apply requires a trailing newline and no stray blank tail from the split.
  return [...header, ...hunks[hunkIndex]].join('\n').replace(/\n*$/, '\n');
}

/** Run `git apply <args>` with `patch` fed on stdin. Resolves true on success. */
function runGitApply(cwd: string, args: string[], patch: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(gitBin, ['apply', ...args], {
      cwd,
      env: gitEnv({ GIT_TERMINAL_PROMPT: '0' }),
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    // A broken pipe (git rejecting the patch early) must not crash the process.
    child.stdin?.on('error', () => {
      /* ignore: the close handler reports the failure via the exit code */
    });
    child.stdin?.end(patch);
  });
}

/** Drop a single trailing empty entry produced by splitting on a final newline. */
function splitContent(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Read `file`'s full content at `source` for the "file view". An unstaged source
 * is the working copy on disk; staged is the index blob (`:path`); a commit is
 * that commit's blob (`hash:path`). Binary/absent files yield an empty list.
 */
async function readFileContent(
  cwd: string,
  source: DiffSource,
  file: string,
): Promise<string[]> {
  if (source.kind === 'unstaged') {
    try {
      // `file` comes from git's own output, but resolve and confine it under the
      // repo root as a guard before touching the filesystem.
      const full = path.resolve(cwd, file);
      const root = path.resolve(cwd);
      if (full !== root && !full.startsWith(root + path.sep)) return [];
      const buf = await fs.promises.readFile(full, 'utf8');
      return splitContent(buf);
    } catch {
      return [];
    }
  }
  const rev = source.kind === 'commit' ? source.hash : '';
  const out = await runGit(cwd, ['show', `${rev}:${file}`]);
  return splitContent(out);
}

/**
 * Read a single commit's full message and GPG signature status. `%G?` triggers
 * signature verification for just this one commit (cheap, unlike doing it across
 * the whole log), and `%B` is the raw message (subject + body).
 */
async function readCommitDetail(
  cwd: string,
  hash: string,
): Promise<{ message: string; signature: string }> {
  const out = await runGit(cwd, [
    'show',
    '--no-patch',
    `--format=%G?${LOG_FS}%B`,
    hash,
  ]);
  const sep = out.indexOf(LOG_FS);
  const signature = sep === -1 ? '' : out.slice(0, sep);
  const message = (sep === -1 ? out : out.slice(sep + 1)).replace(/\s+$/, '');
  return { signature, message };
}

/**
 * Rewrite commit `hash`'s message to `message`. HEAD is amended in place; an
 * older commit is reworded by replaying the commits above it with a
 * non-interactive `git rebase -i`, driven by two scripted editors:
 *   - GIT_SEQUENCE_EDITOR flips the target's `pick` to `reword`. The rebase
 *     starts at the target's parent, so the target is the todo's first line.
 *   - GIT_EDITOR overwrites the commit message with our text.
 * Both are POSIX `sh` one-liners (git ships an `sh`, even on Windows). On any
 * failure the rebase is aborted, leaving the working tree and history untouched.
 */
async function rewordCommit(
  cwd: string,
  hash: string,
  message: string,
): Promise<CommitResult> {
  const env = gitEnv({ GIT_TERMINAL_PROMPT: '0' });
  const head = (await runGit(cwd, ['rev-parse', 'HEAD'])).trim();

  // Rewording HEAD is a plain amend; `--only` with no paths ignores the index,
  // so any staged work the user is preparing is left out of the reword.
  if (head === hash) {
    try {
      await spawnGit(cwd, ['commit', '--amend', '--only', '-m', message], 'reword', env);
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', message: gitErrorMessage(err, 'Amend failed.') };
    }
  }

  // Older commit: reword via rebase. Hand the new message to the scripted
  // GIT_EDITOR through a temp file, and rebase from the target's parent (or
  // `--root` when the target is the repo's first commit).
  const msgDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'gl-reword-'));
  const msgFile = path.join(msgDir, 'message');
  fs.writeFileSync(msgFile, message.endsWith('\n') ? message : `${message}\n`);

  let base: string;
  try {
    await runGit(cwd, ['rev-parse', '--verify', `${hash}^`]);
    base = `${hash}^`;
  } catch {
    base = '--root';
  }

  const rebaseEnv = {
    ...env,
    GL_REWORD_MSG: msgFile,
    // `abbreviateCommands=false` keeps the todo verb as `pick`, so the sed matches.
    GIT_SEQUENCE_EDITOR: `sh -c 'sed "1s/^pick /reword /" "$1" > "$1.gl" && mv "$1.gl" "$1"' sh`,
    GIT_EDITOR: `sh -c 'cat "$GL_REWORD_MSG" > "$1"' sh`,
  };

  try {
    await spawnGit(
      cwd,
      ['-c', 'rebase.abbreviateCommands=false', 'rebase', '-i', '--autostash', base],
      'reword',
      rebaseEnv,
    );
    return { status: 'ok' };
  } catch (err) {
    await execFileAsync(gitBin, ['rebase', '--abort'], { cwd, env }).catch(() => undefined);
    return { status: 'error', message: gitErrorMessage(err, 'Reword failed.') };
  } finally {
    fs.rmSync(msgDir, { recursive: true, force: true });
  }
}

/**
 * Turn a failed `git push`'s stderr into a single, actionable line. Several
 * failures share the same tail ("failed to push some refs") but have very
 * different fixes, so we detect the specific reason before the generic
 * non-fast-forward case — otherwise a scope/permission rejection gets
 * mislabelled as "pull first". A plain non-fast-forward is the last resort,
 * because git's own final line there is just an unhelpful "See the 'Note about
 * fast-forwards'…" pointer.
 */
function pushErrorMessage(err: unknown): string {
  const stderr =
    err && typeof err === 'object' && 'stderr' in err
      ? String((err as { stderr: unknown }).stderr ?? '')
      : '';
  // A GitHub OAuth-App token (what we inject for HTTPS pushes) can't touch
  // workflow files without the `workflow` scope — the local branch is fine.
  if (/without `?workflow`? scope|refusing to allow an? (?:OAuth|GitHub|Personal Access)/i.test(stderr)) {
    return 'The remote rejected a change to a GitHub Actions workflow file: the connected account is missing the “workflow” permission. Push over SSH, or reconnect the account with workflow scope.';
  }
  // Authentication / authorization failures — not a fast-forward problem.
  if (/\b403\b|permission denied|not authorized|authentication failed|could not read Username|remote: Invalid username or password|access rights/i.test(stderr)) {
    return 'The remote refused the push: authentication failed or you don’t have write access. Check the connected account or your credentials.';
  }
  // A local pre-push hook aborted the push before anything reached the remote.
  // When git names the hook we catch it here; otherwise it leaves only the
  // generic "failed to push some refs" on stderr with no "[rejected]" line, so a
  // bare failure with no fast-forward hint is one too — detect both before the
  // non-fast-forward case or they get mislabelled as "pull first".
  const hook = hookFailureMessage(err);
  if (hook) return hook;
  if (/failed to push some refs/i.test(stderr) && !/\[rejected\]|non-fast-forward|fetch first/i.test(stderr)) {
    return 'The pre-push hook failed — see the activity log.';
  }
  if (/\[rejected\]|non-fast-forward|fetch first|failed to push some refs/i.test(stderr)) {
    return 'The remote has commits you don’t have locally. Pull (or fetch and integrate) first, then push again.';
  }
  return gitErrorMessage(err, 'Push failed.');
}

/**
 * Decide whether `branch` has diverged from its `upstream` because the user
 * rewrote local history (an amend, reword or rebase) rather than because the
 * remote genuinely gained new commits — the two look identical to a plain push
 * (both are non-fast-forward) but want opposite fixes (force-push vs. pull).
 *
 * The tell is the reflog: a rewrite leaves the upstream's old commit sitting in
 * *this branch's* reflog as a tip we used to be at, whereas a teammate's new
 * commit was never a local tip and so is absent. We only treat it as a rewrite
 * when the branch is actually behind (`upstream` isn't already an ancestor of
 * HEAD — otherwise a normal fast-forward push is fine and needs no force).
 */
async function divergedByRewrite(cwd: string, branch: string, upstream: string): Promise<boolean> {
  const upstreamSha = (await runGit(cwd, ['rev-parse', '--verify', `${upstream}^{commit}`])).trim();
  if (!upstreamSha) return false;
  // Already reachable from HEAD → we're ahead-only, a plain push fast-forwards.
  const ahead = await isAncestor(cwd, upstreamSha, 'HEAD');
  if (ahead) return false;
  // Was the upstream commit ever a tip of this branch? `git log -g` walks the
  // branch reflog; the old pre-amend/pre-rebase commit shows up there.
  const reflog = await runGit(cwd, ['log', '-g', '--format=%H', branch]);
  return reflog.split('\n').some((sha) => sha.trim() === upstreamSha);
}

/** True when `ancestor` is an ancestor of (or equal to) `descendant`. */
async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await execFileAsync(gitBin, ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd,
      env: gitEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Push the current branch. If it already tracks an upstream, a plain `git push`
 * follows that. Otherwise the branch has no upstream yet: rather than publishing
 * silently, resolve `needs-upstream` with the target remote (the sole remote,
 * preferring "origin") so the UI can confirm creating the branch on the remote —
 * `pushSetUpstream` does the actual publish. Bails with a clear message when the
 * remote is missing or ambiguous. GIT_TERMINAL_PROMPT=0 keeps a credential prompt
 * from hanging the app — an auth-required HTTPS remote surfaces as an error.
 */
async function pushCurrent(cwd: string, force = false): Promise<PushResult> {
  const env = gitEnv({ GIT_TERMINAL_PROMPT: '0' });
  const branch = (await runGit(cwd, ['symbolic-ref', '--short', 'HEAD'])).trim();
  if (!branch) {
    return { status: 'error', message: 'HEAD is detached — check out a branch before pushing.' };
  }
  const upstream = (
    await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  ).trim();

  if (upstream) {
    const remote = remoteOfUpstream(upstream);
    const authArgs = await authArgsForRemotes(cwd, [remote]);
    const sshEnv = await sshEnvForRemotes(cwd, [remote]);
    // A rewritten history (e.g. after an amend) is not a fast-forward. Force with
    // lease — either because the caller asked (the commit panel's amend+push), or
    // because we can see the branch has diverged from its upstream by a *local*
    // rewrite rather than real new remote work. `--force-with-lease` still aborts
    // if the remote actually moved under us, so this can't clobber a teammate.
    const forceLease = force || (await divergedByRewrite(cwd, branch, upstream));
    const pushArgs = forceLease ? ['push', '--force-with-lease'] : ['push'];
    try {
      await spawnGit(cwd, [...authArgs, ...pushArgs], 'push', { ...env, ...sshEnv });
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', message: pushErrorMessage(err) };
    }
  }

  // No upstream yet: resolve the remote to publish to and ask the UI to confirm.
  const remotes = (await runGit(cwd, ['remote']))
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
  if (remotes.length === 0) {
    return { status: 'error', message: 'No remote is configured for this repository.' };
  }
  const remote = remotes.includes('origin')
    ? 'origin'
    : remotes.length === 1
      ? remotes[0]
      : '';
  if (!remote) {
    return {
      status: 'error',
      message: `“${branch}” has no upstream and several remotes exist (${remotes.join(
        ', ',
      )}). Set an upstream branch, then push.`,
    };
  }
  return { status: 'needs-upstream', remote, branch };
}

/**
 * Publish the current branch to `remote`, setting it as the upstream
 * (`git push --set-upstream remote branch`). Called after the user confirms a
 * `needs-upstream` result. `remote`/`branch` are re-validated by the caller
 * against the repo's own remotes and current HEAD before reaching here.
 */
/**
 * Validate a would-be branch name via `git check-ref-format`, so untrusted input
 * can't smuggle refspec syntax or options into the push. Returns false on any
 * non-zero exit (invalid name) as well as on shapes git would reject.
 */
async function isValidBranchName(cwd: string, name: string): Promise<boolean> {
  if (!name || name.startsWith('-')) return false;
  try {
    await execFileAsync(gitBin, ['check-ref-format', '--branch', name], {
      cwd,
      env: gitEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

async function pushSetUpstream(
  cwd: string,
  remote: string,
  branch: string,
  remoteBranch = branch,
): Promise<CommitResult> {
  const env = gitEnv({ GIT_TERMINAL_PROMPT: '0' });
  // Use an explicit `local:remote` refspec only when the names differ, so the
  // branch is created under the requested name on the remote.
  const refspec = remoteBranch === branch ? branch : `${branch}:${remoteBranch}`;
  const authArgs = await authArgsForRemotes(cwd, [remote]);
  const sshEnv = await sshEnvForRemotes(cwd, [remote]);
  try {
    await spawnGit(
      cwd,
      [...authArgs, 'push', '--set-upstream', remote, refspec],
      'push',
      { ...env, ...sshEnv },
    );
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: pushErrorMessage(err) };
  }
}

/**
 * Interpret a failed `git pull`/`fetch`. Conflict and "divergent branches"
 * notices land on stdout as often as stderr, so we scan both streams and map
 * the common cases to one clear line before falling back to the generic tail.
 */
function pullErrorMessage(err: unknown): string {
  let output = '';
  if (err && typeof err === 'object') {
    const e = err as { stdout?: unknown; stderr?: unknown };
    output = `${String(e.stdout ?? '')}\n${String(e.stderr ?? '')}`;
  }
  if (/no tracking information|no upstream|do not have a branch/i.test(output)) {
    return 'This branch has no upstream to pull from. Set one, then pull.';
  }
  if (/not possible to fast-forward|need to specify how to reconcile|diverg/i.test(output)) {
    return 'Your branch and the remote have diverged, so a fast-forward isn’t possible. Pull with rebase or a merge instead.';
  }
  // Dirty working tree: git aborts before merging so nothing is lost, but its
  // final line is a bare "Aborting". Name the real blocker instead.
  if (/local changes to the following files would be overwritten/i.test(output)) {
    return 'You have uncommitted changes that the pull would overwrite. Commit or stash them, then pull.';
  }
  if (/untracked working tree files would be overwritten/i.test(output)) {
    return 'Untracked files in your working tree clash with incoming files. Move or remove them, then pull.';
  }
  if (/CONFLICT|Automatic merge failed|could not apply|Resolve all conflicts/i.test(output)) {
    return 'Pull stopped on conflicts. Resolve them in your working tree, then continue.';
  }
  return gitErrorMessage(err, 'Pull failed.');
}

/**
 * Pull (or, for `fetch-all`, fetch) the current branch from its upstream. The
 * mode maps straight onto git's flags. GIT_TERMINAL_PROMPT=0 keeps an
 * auth-required remote from hanging the app.
 */
async function pullCurrent(cwd: string, mode: PullMode): Promise<CommitResult> {
  const env = gitEnv({ GIT_TERMINAL_PROMPT: '0' });
  const args =
    mode === 'fetch-all'
      ? ['fetch', '--all']
      : mode === 'ff-only'
        ? ['pull', '--ff-only']
        : mode === 'rebase'
          ? ['pull', '--rebase']
          : ['pull'];

  // `fetch --all` touches every remote; the pull modes talk to the current
  // branch's upstream. Authenticate whichever remotes are involved.
  let remotes: string[];
  if (mode === 'fetch-all') {
    remotes = (await runGit(cwd, ['remote']))
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean);
  } else {
    const upstream = (
      await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
    ).trim();
    remotes = upstream ? [remoteOfUpstream(upstream)] : [];
  }
  const authArgs = await authArgsForRemotes(cwd, remotes);
  const sshEnv = await sshEnvForRemotes(cwd, remotes);

  try {
    await spawnGit(cwd, [...authArgs, ...args], activityOp(args), { ...env, ...sshEnv });
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: pullErrorMessage(err) };
  }
}

/** Map a porcelain status letter (untracked '?' included) to a FileStatus. */
function mapPorcelainStatus(code: string): FileStatus {
  switch (code) {
    case 'A':
    case '?':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
    case 'C':
      return 'renamed';
    default:
      return 'modified';
  }
}

async function readStatus(cwd: string): Promise<WorkingStatus> {
  // -z: NUL-separated entries; each is "XY <path>", X=index (staged), Y=worktree.
  // Renames/copies append an extra NUL-separated original path we must consume.
  const out = await runGit(cwd, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  const parts = out.split('\0');
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];

  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue; // "XY p" is the shortest valid entry
    const x = entry[0];
    const y = entry[1];
    const path = entry.slice(3);
    // A rename/copy carries its source path in the following field.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++;

    // Unmerged (conflicted) entries belong to the merge resolver, not the
    // staged/unstaged lists — a `UU` would otherwise show up in both.
    if (isUnmergedCode(x, y)) continue;

    if (x !== ' ' && x !== '?') staged.push({ path, status: mapPorcelainStatus(x) });
    if (y !== ' ') unstaged.push({ path, status: mapPorcelainStatus(y) });
  }

  return { staged, unstaged };
}

/**
 * Whether a porcelain-v1 XY code pair marks an unmerged (conflicted) entry:
 * either side is `U`, or both sides added (`AA`), or both sides deleted (`DD`).
 */
function isUnmergedCode(x: string, y: string): boolean {
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
}

/** Map a porcelain-v1 unmerged XY pair to a human `ConflictKind`. */
function mapConflictKind(x: string, y: string): ConflictKind {
  const xy = `${x}${y}`;
  switch (xy) {
    case 'AA':
      return 'both-added';
    case 'DD':
      return 'both-deleted';
    case 'AU':
      return 'added-by-us';
    case 'UA':
      return 'added-by-them';
    case 'DU':
      return 'deleted-by-us';
    case 'UD':
      return 'deleted-by-them';
    default: // UU
      return 'both-modified';
  }
}

/** List the working tree's unmerged paths (conflicts), or [] when there are none. */
async function readConflicts(cwd: string): Promise<ConflictFile[]> {
  const out = await runGit(cwd, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=no',
  ]);
  const parts = out.split('\0');
  const conflicts: ConflictFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const x = entry[0];
    const y = entry[1];
    const path = entry.slice(3);
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++;
    if (!isUnmergedCode(x, y)) continue;
    conflicts.push({ path, kind: mapConflictKind(x, y), binary: false });
  }
  // Flag binary conflicts so the resolver offers only whole-side resolution.
  await Promise.all(
    conflicts.map(async (c) => {
      c.binary = await isBinaryConflict(cwd, c.path);
    }),
  );
  return conflicts;
}

/**
 * Whether a conflicted file is binary. `git diff --numstat` reports `-\t-` for a
 * binary path; we diff the two conflicting sides (stages 2 and 3) of the file.
 */
async function isBinaryConflict(cwd: string, file: string): Promise<boolean> {
  const out = await runGit(cwd, ['diff', '--numstat', '--', file]);
  return /^-\t-\t/.test(out.trim());
}

/**
 * Read the in-progress conflict state, or `null` when the tree has no conflicts
 * and no merge/rebase/cherry-pick/revert is under way. The operation is
 * identified by the marker git leaves in the git dir; a stash-pop conflict has
 * no marker of its own, so it's inferred from unmerged files with no operation.
 */
async function readMergeState(cwd: string): Promise<MergeState | null> {
  const gitDir = (await runGit(cwd, ['rev-parse', '--git-dir'])).trim();
  if (!gitDir) return null;
  const abs = path.isAbsolute(gitDir) ? gitDir : path.resolve(cwd, gitDir);
  const has = (name: string): boolean => fs.existsSync(path.join(abs, name));

  const conflicts = await readConflicts(cwd);

  let op: MergeOp | null = null;
  let description = '';
  let step: MergeState['step'];
  const branch = (await currentBranchName(cwd)) || 'HEAD';

  if (has('rebase-merge') || has('rebase-apply')) {
    op = 'rebase';
    // Interactive/merge rebases use rebase-merge/ (msgnum + end); the older
    // am-based rebase uses rebase-apply/ (next + last).
    const merge = has('rebase-merge');
    const dir = merge ? 'rebase-merge' : 'rebase-apply';
    const onto = readGitFile(abs, path.join(dir, 'onto'));
    const head = readGitFile(abs, path.join(dir, 'head-name')).replace('refs/heads/', '');
    const current = Number(readGitFile(abs, path.join(dir, merge ? 'msgnum' : 'next')));
    const total = Number(readGitFile(abs, path.join(dir, merge ? 'end' : 'last')));
    if (current > 0 && total > 0) step = { current, total };
    description = `Rebasing ${head || branch}${onto ? ` onto ${onto.slice(0, 12)}` : ''}`;
  } else if (has('MERGE_HEAD')) {
    op = 'merge';
    const msg = readGitFile(abs, 'MERGE_MSG');
    const other = /Merge (?:branch|remote-tracking branch|commit) ['"]?([^'"\n]+)/.exec(msg);
    description = other ? `Merging ${other[1]} into ${branch}` : `Merging into ${branch}`;
  } else if (has('CHERRY_PICK_HEAD')) {
    op = 'cherry-pick';
    description = 'Cherry-picking';
  } else if (has('REVERT_HEAD')) {
    op = 'revert';
    description = 'Reverting';
  } else if (conflicts.length > 0) {
    op = 'stash-pop';
    description = 'Applying stashed changes';
  }

  if (op === null) return null;

  return {
    op,
    description,
    step,
    conflicts,
    canContinue: op !== 'stash-pop',
    canSkip: op === 'rebase',
  };
}

/** Read a text file inside the git dir, trimmed; '' when absent/unreadable. */
function readGitFile(gitDir: string, name: string): string {
  try {
    return fs.readFileSync(path.join(gitDir, name), 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * Read a conflicted file's three merge sides — base (stage 1), ours (stage 2),
 * theirs (stage 3) — plus the on-disk working copy with git's conflict markers.
 * A missing stage resolves to `null` (e.g. no base for add/add). Binary files
 * short-circuit with empty content; the caller offers only whole-side picks.
 */
async function readConflictFile(cwd: string, file: string): Promise<ConflictFileContent> {
  const binary = await isBinaryConflict(cwd, file);
  if (binary) {
    return { path: file, binary: true, base: null, ours: null, theirs: null, merged: [] };
  }
  const stage = async (n: number): Promise<string[] | null> => {
    // `git show :N:path` prints stage N of the index, but a missing stage errors
    // and runGit swallows it to '' — so check the stage exists before reading it,
    // to tell "absent side" (null) apart from "present but empty".
    if (!(await stageExists(cwd, n, file))) return null;
    return splitContent(await runGit(cwd, ['show', `:${n}:${file}`]));
  };
  const [base, ours, theirs] = await Promise.all([stage(1), stage(2), stage(3)]);
  const merged = await readFileContent(cwd, { kind: 'unstaged' }, file);
  return { path: file, binary: false, base, ours, theirs, merged };
}

/** Whether index stage `n` exists for `file` (a side of the conflict). */
async function stageExists(cwd: string, n: number, file: string): Promise<boolean> {
  const out = await runGit(cwd, ['ls-files', '-u', '-z', '--', file]);
  // Entries look like "<mode> <sha> <stage>\t<path>"; check for the stage digit.
  return out.split('\0').some((line) => new RegExp(`\\s${n}\\t`).test(line));
}

/** Validate an untrusted merge-resolution payload from IPC, or null if invalid. */
function asMergeResolution(value: unknown): MergeResolution | null {
  if (typeof value !== 'object' || value === null) return null;
  const res = value as { kind?: unknown; text?: unknown };
  if (res.kind === 'ours' || res.kind === 'theirs') return { kind: res.kind };
  if (res.kind === 'content' && typeof res.text === 'string') {
    return { kind: 'content', text: res.text };
  }
  return null;
}

/** Resolve `path` inside `cwd`, or throw if it escapes the repo root. */
function resolveInRepo(cwd: string, file: string): string {
  const full = path.resolve(cwd, file);
  const root = path.resolve(cwd);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('Path escapes the repository.');
  }
  return full;
}

/**
 * Resolve one conflicted `file` and stage it. A whole-side pick checks out that
 * side (or removes the file when the side deleted it); a `content` resolution
 * writes the hand-merged text. Returns the refreshed merge state.
 */
async function resolveConflictFile(
  cwd: string,
  file: string,
  resolution: MergeResolution,
): Promise<MergeState | null> {
  const env = gitEnv({ GIT_TERMINAL_PROMPT: '0' });
  if (resolution.kind === 'content') {
    // `splitContent` dropped the file's trailing newline when reading; restore it
    // so a resolved file keeps the POSIX end-of-file newline.
    const text =
      resolution.text.length > 0 && !resolution.text.endsWith('\n')
        ? `${resolution.text}\n`
        : resolution.text;
    await fs.promises.writeFile(resolveInRepo(cwd, file), text, 'utf8');
    await spawnGit(cwd, ['add', '--', file], 'add', env);
  } else {
    const stage = resolution.kind === 'ours' ? 2 : 3;
    if (await stageExists(cwd, stage, file)) {
      const flag = resolution.kind === 'ours' ? '--ours' : '--theirs';
      await spawnGit(cwd, ['checkout', flag, '--', file], 'checkout', env);
      await spawnGit(cwd, ['add', '--', file], 'add', env);
    } else {
      // The chosen side deleted the file — accept the deletion.
      await spawnGit(cwd, ['rm', '-f', '--', file], 'rm', env);
    }
  }
  return readMergeState(cwd);
}

/** The git step that finishes each conflicting operation once resolved. */
const CONTINUE_STEP: Record<MergeOp, string[] | null> = {
  merge: ['commit', '--no-edit'],
  rebase: ['rebase', '--continue'],
  'cherry-pick': ['cherry-pick', '--continue'],
  revert: ['revert', '--continue'],
  'stash-pop': null,
};

/** The git step that aborts each conflicting operation. */
const ABORT_STEP: Record<MergeOp, string[] | null> = {
  merge: ['merge', '--abort'],
  rebase: ['rebase', '--abort'],
  'cherry-pick': ['cherry-pick', '--abort'],
  revert: ['revert', '--abort'],
  'stash-pop': null,
};

/**
 * Finish the in-progress operation. Refuses while conflicts remain. Runs with
 * scripted editors (`GIT_EDITOR`/`GIT_SEQUENCE_EDITOR` = `true`) so a continue
 * never opens an interactive editor and hangs the app.
 */
async function continueOperation(cwd: string): Promise<RefsMutationResult> {
  const state = await readMergeState(cwd);
  if (!state) return { status: 'error', message: 'Nothing to continue.' };
  if (state.conflicts.length > 0) {
    return { status: 'error', message: 'Resolve every conflict before continuing.' };
  }
  const step = CONTINUE_STEP[state.op];
  if (!step) return { status: 'error', message: 'This operation cannot be continued.' };
  const env = gitEnv({
    GIT_TERMINAL_PROMPT: '0',
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
  });
  try {
    await spawnGit(cwd, step, activityOp(step), env);
  } catch (err) {
    return { status: 'error', message: gitErrorMessage(err, 'Could not continue.') };
  }
  return { status: 'ok', refs: await readRefs(cwd) };
}

/** Abort the in-progress operation, restoring the pre-operation state. */
async function abortOperation(cwd: string): Promise<RefsMutationResult> {
  const state = await readMergeState(cwd);
  if (!state) return { status: 'error', message: 'Nothing to abort.' };
  const step = ABORT_STEP[state.op];
  if (!step) return { status: 'error', message: 'This operation cannot be aborted.' };
  return mutateRepo(cwd, [step], 'Could not abort.');
}

/** Skip the current commit during a rebase (`git rebase --skip`). */
async function skipRebaseStep(cwd: string): Promise<RefsMutationResult> {
  const env = gitEnv({
    GIT_TERMINAL_PROMPT: '0',
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
  });
  try {
    await spawnGit(cwd, ['rebase', '--skip'], 'rebase', env);
  } catch (err) {
    return { status: 'error', message: gitErrorMessage(err, 'Could not skip.') };
  }
  return { status: 'ok', refs: await readRefs(cwd) };
}

// ---- Working-tree watching -----------------------------------------------

/** Coalesce a burst of filesystem events into a single change signal. */
const WATCH_DEBOUNCE_MS = 150;

interface RepoWatch {
  watcher: fs.FSWatcher;
  timer: NodeJS.Timeout | null;
}

// One watcher per renderer, for the repo it currently shows.
const repoWatchers = new Map<Electron.WebContents, RepoWatch>();
// Renderers whose 'destroyed' cleanup we've already hooked.
const watchCleanupHooked = new WeakSet<Electron.WebContents>();

/** Tear down the watcher (if any) currently registered for `wc`. */
function stopRepoWatch(wc: Electron.WebContents): void {
  const existing = repoWatchers.get(wc);
  if (!existing) return;
  if (existing.timer) clearTimeout(existing.timer);
  existing.watcher.close();
  repoWatchers.delete(wc);
}

/**
 * Watch `repoPath`'s working tree for a renderer, replacing any prior watch.
 * Events inside `.git` are ignored — index/lock/object churn would fire
 * constantly and isn't a working-tree edit (branch/commit changes are picked up
 * by the focus refresh). Bursts are debounced, then the renderer is told its
 * repo changed so it can re-read status/refs/log.
 */
function startRepoWatch(wc: Electron.WebContents, repoPath: string): void {
  stopRepoWatch(wc);
  if (!isGitRepo(repoPath)) return;
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(repoPath, { recursive: true });
  } catch {
    // Recursive watching may be unavailable on some platforms; degrade to the
    // focus-based refresh rather than crash.
    return;
  }
  const entry: RepoWatch = { watcher, timer: null };
  repoWatchers.set(wc, entry);
  watcher.on('error', () => stopRepoWatch(wc));
  watcher.on('change', (_type, filename) => {
    const name = filename?.toString();
    if (name && (name === '.git' || name.startsWith('.git/') || name.startsWith(`.git${path.sep}`))) {
      return;
    }
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (!wc.isDestroyed()) wc.send(RepoChannels.changed, repoPath);
    }, WATCH_DEBOUNCE_MS);
  });
}

function registerRepoIpc(): void {
  ipcMain.on(RepoChannels.watch, (event, repoPath: unknown) => {
    const wc = event.sender;
    if (!watchCleanupHooked.has(wc)) {
      watchCleanupHooked.add(wc);
      wc.once('destroyed', () => stopRepoWatch(wc));
    }
    if (typeof repoPath === 'string') startRepoWatch(wc, repoPath);
    else stopRepoWatch(wc);
  });

  ipcMain.handle(
    RepoChannels.listRefs,
    async (_event, repoPath: unknown): Promise<RepoRefs> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return {
          localBranches: [],
          remoteBranches: [],
          remotes: [],
          tags: [],
          stashes: [],
          worktrees: [],
        };
      }
      return readRefs(repoPath);
    },
  );

  ipcMain.handle(
    RepoChannels.log,
    async (_event, repoPath: unknown, limit: unknown): Promise<CommitLogEntry[]> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return [];
      const max =
        typeof limit === 'number' && limit > 0 ? Math.floor(limit) : DEFAULT_LOG_LIMIT;
      const commits = await readLog(repoPath, max);
      // Fill in real GitHub avatars in the background; the graph re-reads the log
      // via a repo:changed broadcast once any resolve.
      void enrichGithubAvatars(repoPath, commits);
      return commits;
    },
  );

  ipcMain.handle(
    RepoChannels.commitFiles,
    async (_event, repoPath: unknown, hash: unknown): Promise<FileChange[]> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return [];
      if (typeof hash !== 'string' || hash.length === 0) return [];
      return readCommitFiles(repoPath, hash);
    },
  );

  ipcMain.handle(
    RepoChannels.commitTree,
    async (_event, repoPath: unknown, hash: unknown): Promise<string[]> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return [];
      if (typeof hash !== 'string' || hash.length === 0) return [];
      return readCommitTree(repoPath, hash);
    },
  );

  // Narrow an untrusted IPC value to a DiffSource, or null if it isn't one.
  const asDiffSource = (value: unknown): DiffSource | null => {
    if (typeof value !== 'object' || value === null) return null;
    const source = value as { kind?: unknown; hash?: unknown };
    if (source.kind === 'staged' || source.kind === 'unstaged') {
      return { kind: source.kind };
    }
    if (source.kind === 'commit' && typeof source.hash === 'string' && source.hash.length > 0) {
      return { kind: 'commit', hash: source.hash };
    }
    return null;
  };

  ipcMain.handle(
    RepoChannels.fileDiff,
    async (
      _event,
      repoPath: unknown,
      source: unknown,
      file: unknown,
    ): Promise<FileDiff> => {
      const src = asDiffSource(source);
      if (
        typeof repoPath !== 'string' ||
        !isGitRepo(repoPath) ||
        src === null ||
        typeof file !== 'string' ||
        file.length === 0
      ) {
        return { path: typeof file === 'string' ? file : '', binary: false, lines: [] };
      }
      return readFileDiff(repoPath, src, file);
    },
  );

  ipcMain.handle(
    RepoChannels.fileContent,
    async (
      _event,
      repoPath: unknown,
      source: unknown,
      file: unknown,
    ): Promise<string[]> => {
      const src = asDiffSource(source);
      if (
        typeof repoPath !== 'string' ||
        !isGitRepo(repoPath) ||
        src === null ||
        typeof file !== 'string' ||
        file.length === 0
      ) {
        return [];
      }
      return readFileContent(repoPath, src, file);
    },
  );

  ipcMain.handle(
    RepoChannels.commitDetail,
    async (_event, repoPath: unknown, hash: unknown): Promise<CommitDetailData> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath))
        return { message: '', signature: '' };
      if (typeof hash !== 'string' || hash.length === 0)
        return { message: '', signature: '' };
      return readCommitDetail(repoPath, hash);
    },
  );

  const emptyStatus: WorkingStatus = { staged: [], unstaged: [] };

  ipcMain.handle(
    RepoChannels.status,
    async (_event, repoPath: unknown): Promise<WorkingStatus> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return emptyStatus;
      return readStatus(repoPath);
    },
  );

  ipcMain.handle(
    RepoChannels.stage,
    async (_event, repoPath: unknown, file: unknown): Promise<WorkingStatus> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return emptyStatus;
      // A specific path stages just that file (incl. deletions); null stages all.
      const args =
        typeof file === 'string' && file.length > 0
          ? ['add', '-A', '--', file]
          : ['add', '-A'];
      await runGit(repoPath, args);
      return readStatus(repoPath);
    },
  );

  // Stage/discard/unstage a single hunk by carving it out of the file's live diff
  // and (reverse-)applying it. The renderer numbers hunks in diff order, so
  // re-deriving the patch here keeps those indices aligned. `from` picks which
  // diff the hunk is taken from: the unstaged (worktree-vs-index) diff for
  // stage/discard, or the staged (index-vs-HEAD) diff for unstage.
  const applyHunk = async (
    repoPath: unknown,
    file: unknown,
    hunkIndex: unknown,
    from: 'staged' | 'unstaged',
    args: string[],
  ): Promise<WorkingStatus> => {
    if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return emptyStatus;
    if (typeof file !== 'string' || file.length === 0) return readStatus(repoPath);
    if (typeof hunkIndex !== 'number' || !Number.isInteger(hunkIndex) || hunkIndex < 0) {
      return readStatus(repoPath);
    }
    const rawDiff =
      from === 'staged'
        ? await runGit(repoPath, fileDiffArgs({ kind: 'staged' }, file))
        : await rawUnstagedDiff(repoPath, file);
    const patch = extractHunkPatch(rawDiff, hunkIndex);
    if (patch !== null) await runGitApply(repoPath, args, patch);
    return readStatus(repoPath);
  };

  ipcMain.handle(
    RepoChannels.stageHunk,
    (_event, repoPath: unknown, file: unknown, hunkIndex: unknown): Promise<WorkingStatus> =>
      applyHunk(repoPath, file, hunkIndex, 'unstaged', ['--cached']),
  );

  ipcMain.handle(
    RepoChannels.discardHunk,
    (_event, repoPath: unknown, file: unknown, hunkIndex: unknown): Promise<WorkingStatus> =>
      applyHunk(repoPath, file, hunkIndex, 'unstaged', ['--reverse']),
  );

  // Unstage reverse-applies the hunk to the index alone (worktree untouched).
  ipcMain.handle(
    RepoChannels.unstageHunk,
    (_event, repoPath: unknown, file: unknown, hunkIndex: unknown): Promise<WorkingStatus> =>
      applyHunk(repoPath, file, hunkIndex, 'staged', ['--cached', '--reverse']),
  );

  ipcMain.handle(
    RepoChannels.unstage,
    async (_event, repoPath: unknown, file: unknown): Promise<WorkingStatus> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return emptyStatus;
      // `reset` works whether or not HEAD exists yet (unlike `restore --staged`).
      const args =
        typeof file === 'string' && file.length > 0
          ? ['reset', '-q', '--', file]
          : ['reset', '-q'];
      await runGit(repoPath, args);
      return readStatus(repoPath);
    },
  );

  ipcMain.handle(
    RepoChannels.discardAll,
    async (_event, repoPath: unknown): Promise<WorkingStatus> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return emptyStatus;
      // Revert tracked modifications and drop the index (no-op when there's no
      // HEAD yet); a plain reset then unstages any freshly-added files in a
      // commit-less repo; clean removes untracked files and directories.
      await runGit(repoPath, ['reset', '--hard', 'HEAD']);
      await runGit(repoPath, ['reset', '-q']);
      await runGit(repoPath, ['clean', '-fd']);
      return readStatus(repoPath);
    },
  );

  ipcMain.handle(
    RepoChannels.discardFile,
    async (_event, repoPath: unknown, file: unknown): Promise<WorkingStatus> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return emptyStatus;
      if (typeof file !== 'string' || file.length === 0) return readStatus(repoPath);
      // Per-file mirror of discardAll (git forbids `reset --hard <path>`): unstage
      // the path so its index entry matches HEAD, restore the working copy from
      // there, then clean removes it if it was untracked (a freshly-added file).
      await runGit(repoPath, ['reset', '-q', '--', file]);
      await runGit(repoPath, ['checkout', '--', file]);
      await runGit(repoPath, ['clean', '-fd', '--', file]);
      return readStatus(repoPath);
    },
  );

  ipcMain.handle(
    RepoChannels.ignore,
    async (
      _event,
      repoPath: unknown,
      pattern: unknown,
      untrackFile: unknown,
    ): Promise<WorkingStatus> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return emptyStatus;
      // Take only the first line so a pattern can never inject extra rules.
      const line = typeof pattern === 'string' ? pattern.split('\n')[0].trim() : '';
      if (line) {
        const gitignorePath = path.join(repoPath, '.gitignore');
        let existing = '';
        try {
          existing = await fs.promises.readFile(gitignorePath, 'utf8');
        } catch {
          existing = ''; // No .gitignore yet — we'll create it.
        }
        // Skip the write when the exact rule is already present (ignoring blank space).
        const present = existing.split('\n').some((entry) => entry.trim() === line);
        if (!present) {
          // Ensure the new rule starts on its own line.
          const prefix =
            existing.length === 0 || existing.endsWith('\n') ? existing : `${existing}\n`;
          await fs.promises.writeFile(gitignorePath, `${prefix}${line}\n`, 'utf8');
        }
      }
      // Optionally stop tracking the file: drop it from the index but keep the
      // working copy (-f gets past the index/worktree difference safety check).
      if (typeof untrackFile === 'string' && untrackFile.length > 0) {
        await runGit(repoPath, ['rm', '--cached', '-f', '--', untrackFile]);
      }
      return readStatus(repoPath);
    },
  );

  ipcMain.handle(
    RepoChannels.isTracked,
    async (_event, repoPath: unknown, file: unknown): Promise<boolean> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return false;
      if (typeof file !== 'string' || file.length === 0) return false;
      // ls-files prints the path only when git already tracks it (index/HEAD).
      const out = await runGit(repoPath, ['ls-files', '--', file]);
      return out.trim().length > 0;
    },
  );

  ipcMain.handle(
    RepoChannels.deleteFile,
    async (_event, repoPath: unknown, file: unknown): Promise<WorkingStatus> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return emptyStatus;
      if (typeof file !== 'string' || file.length === 0) return readStatus(repoPath);
      const target = path.resolve(repoPath, file);
      // Refuse paths that escape the repository (defence against traversal in IPC args).
      const rel = path.relative(repoPath, target);
      if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return readStatus(repoPath);
      // Send to the OS trash (recoverable) rather than an unrecoverable unlink.
      try {
        await shell.trashItem(target);
      } catch {
        // Already gone / not trashable — just report the resulting status.
      }
      return readStatus(repoPath);
    },
  );

  ipcMain.handle(
    RepoChannels.commit,
    async (_event, repoPath: unknown, message: unknown, amend: unknown): Promise<CommitResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      const text = typeof message === 'string' ? message.trim() : '';
      if (!text) return { status: 'error', message: 'Enter a commit message.' };
      const args = amend === true ? ['commit', '--amend', '-m', text] : ['commit', '-m', text];
      try {
        await spawnGit(repoPath, args, 'commit');
      } catch (err) {
        // A pre-commit / commit-msg hook aborts with only its own output (git
        // adds no line of its own), which is noisy and often ANSI-styled in a
        // toast. When such a hook is installed and git didn't speak up itself,
        // treat it as a hook rejection and point the user at the activity log,
        // where the hook's full output already streamed.
        if (
          !looksLikeNativeGitError(err) &&
          (await hasEnabledHook(repoPath, ['pre-commit', 'commit-msg', 'prepare-commit-msg']))
        ) {
          return { status: 'error', message: 'A commit hook rejected the commit.', hookFailure: true };
        }
        return { status: 'error', message: gitErrorMessage(err, 'Commit failed.') };
      }
      return { status: 'ok' };
    },
  );

  ipcMain.handle(
    RepoChannels.commitDraft,
    async (_event, repoPath: unknown): Promise<string> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return '';
      const file = await commitDraftFile(repoPath);
      if (!file) return '';
      try {
        return await fs.promises.readFile(file, 'utf8');
      } catch {
        // No draft saved yet.
        return '';
      }
    },
  );

  ipcMain.handle(
    RepoChannels.setCommitDraft,
    async (_event, repoPath: unknown, message: unknown): Promise<void> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return;
      if (typeof message !== 'string') return;
      const file = await commitDraftFile(repoPath);
      if (!file) return;
      try {
        if (message.length === 0) await fs.promises.rm(file, { force: true });
        else await fs.promises.writeFile(file, message, 'utf8');
      } catch {
        // Best-effort persistence — a lost draft isn't worth an error dialog.
      }
    },
  );

  ipcMain.handle(
    RepoChannels.headMessage,
    async (_event, repoPath: unknown): Promise<string> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return '';
      return (await runGit(repoPath, ['log', '-1', '--pretty=%B'])).replace(/\n+$/, '');
    },
  );

  ipcMain.handle(
    RepoChannels.reword,
    async (
      _event,
      repoPath: unknown,
      hash: unknown,
      message: unknown,
    ): Promise<CommitResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      if (typeof hash !== 'string' || hash.length === 0) {
        return { status: 'error', message: 'No commit selected.' };
      }
      const text = typeof message === 'string' ? message.trim() : '';
      if (!text) return { status: 'error', message: 'Enter a commit message.' };
      return rewordCommit(repoPath, hash, text);
    },
  );

  ipcMain.handle(
    RepoChannels.rewordCount,
    async (_event, repoPath: unknown, hash: unknown): Promise<number> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return 0;
      if (typeof hash !== 'string' || hash.length === 0) return 0;
      // The rebase replays the target's parent..HEAD, i.e. the target plus every
      // descendant. `hash..HEAD` counts only the descendants, so add the target.
      // (Excluding the target sidesteps the root-commit `hash^` having no parent.)
      const out = await runGit(repoPath, ['rev-list', '--count', `${hash}..HEAD`]);
      const descendants = Number.parseInt(out.trim(), 10);
      return Number.isNaN(descendants) ? 0 : descendants + 1;
    },
  );

  ipcMain.handle(
    RepoChannels.undoState,
    async (_event, repoPath: unknown): Promise<UndoRedoState> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { undo: null, redo: null };
      }
      const history = await ensureHistory(repoPath);
      return {
        undo: history.past[0]?.label ?? null,
        redo: history.future[0]?.label ?? null,
      };
    },
  );

  ipcMain.handle(
    RepoChannels.undo,
    async (_event, repoPath: unknown): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      const history = await ensureHistory(repoPath);
      const move = history.past[0];
      if (!move) return { status: 'error', message: 'Nothing to undo.' };
      const result = await travelHistory(repoPath, move.undo);
      if (result.status === 'error') return result; // HEAD unmoved; leave the stack.
      history.past.shift();
      history.future.unshift(move);
      history.expectedHead = await headHash(repoPath);
      return result;
    },
  );

  ipcMain.handle(
    RepoChannels.redo,
    async (_event, repoPath: unknown): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      const history = await ensureHistory(repoPath);
      const move = history.future[0];
      if (!move) return { status: 'error', message: 'Nothing to redo.' };
      const result = await travelHistory(repoPath, move.redo);
      if (result.status === 'error') return result;
      history.future.shift();
      history.past.unshift(move);
      history.expectedHead = await headHash(repoPath);
      return result;
    },
  );

  ipcMain.handle(
    RepoChannels.push,
    async (_event, repoPath: unknown, force: unknown): Promise<PushResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      return pushCurrent(repoPath, force === true);
    },
  );

  ipcMain.handle(
    RepoChannels.pushSetUpstream,
    async (
      _event,
      repoPath: unknown,
      remote: unknown,
      branch: unknown,
      remoteBranch: unknown,
    ): Promise<CommitResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      if (typeof remote !== 'string' || typeof branch !== 'string') {
        return { status: 'error', message: 'Invalid push target.' };
      }
      // The remote branch name is optional; empty/undefined means "same as local".
      // Validate it as a git ref before letting it near the push refspec.
      const targetBranch =
        typeof remoteBranch === 'string' && remoteBranch.trim() ? remoteBranch.trim() : branch;
      if (!(await isValidBranchName(repoPath, targetBranch))) {
        return { status: 'error', message: `“${targetBranch}” is not a valid branch name.` };
      }
      // Re-validate the untrusted args against the repo's own state: the remote
      // must be configured, and the branch must still be the checked-out one.
      // This keeps arbitrary strings out of the git invocation.
      const remotes = (await runGit(repoPath, ['remote']))
        .split('\n')
        .map((name) => name.trim())
        .filter(Boolean);
      if (!remotes.includes(remote)) {
        return { status: 'error', message: `Unknown remote “${remote}”.` };
      }
      const current = (await runGit(repoPath, ['symbolic-ref', '--short', 'HEAD'])).trim();
      if (!current || current !== branch) {
        return {
          status: 'error',
          message: 'The branch to publish has changed. Push again to retry.',
        };
      }
      return pushSetUpstream(repoPath, remote, branch, targetBranch);
    },
  );

  ipcMain.handle(
    RepoChannels.pull,
    async (_event, repoPath: unknown, mode: unknown): Promise<CommitResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      const chosen = PULL_MODES.includes(mode as PullMode) ? (mode as PullMode) : 'ff';
      return pullCurrent(repoPath, chosen);
    },
  );

  ipcMain.handle(
    RepoChannels.checkout,
    async (
      _event,
      repoPath: unknown,
      branch: unknown,
      remote: unknown,
    ): Promise<CheckoutResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      if (typeof branch !== 'string' || branch.length === 0) {
        return { status: 'error', message: 'No branch was specified.' };
      }
      const env = gitEnv({ GIT_TERMINAL_PROMPT: '0' });
      try {
        // A remote was named and no local branch of this name exists yet: create
        // a tracking branch off that specific remote. This disambiguates the case
        // where several remotes share the branch name, which a bare
        // `git checkout <branch>` refuses to guess. If the local branch already
        // exists we fall through and just switch to it.
        const args =
          typeof remote === 'string' &&
          remote.length > 0 &&
          !(await localBranchExists(repoPath, branch))
            ? ['checkout', '-b', branch, '--track', `${remote}/${branch}`]
            : ['checkout', branch];
        // Array args (no shell) avoid injection; branch/remote come from the
        // repo's own ref list. GIT_TERMINAL_PROMPT=0 fails fast instead of prompting.
        await spawnGit(repoPath, args, 'checkout', env);
      } catch (err) {
        return {
          status: 'error',
          message: gitErrorMessage(err, `Could not check out “${branch}”.`),
        };
      }
      return { status: 'ok', refs: await readRefs(repoPath) };
    },
  );

  ipcMain.handle(
    RepoChannels.createBranch,
    async (
      _event,
      repoPath: unknown,
      name: unknown,
    ): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      // Keep the name to a safe, ref-legal slug so it can't inject flags/paths.
      const branch = typeof name === 'string' ? name.trim() : '';
      if (!branch || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('-')) {
        return { status: 'error', message: 'Enter a valid branch name.' };
      }
      if (await localBranchExists(repoPath, branch)) {
        return { status: 'error', message: `Branch “${branch}” already exists.` };
      }
      // Create at HEAD and switch to it. The slug regex already forbids a leading
      // dash, so the name can't be read as a flag (matching the checkout handler).
      return mutateRepo(
        repoPath,
        [['checkout', '-b', branch]],
        `Could not create “${branch}”.`,
      );
    },
  );

  ipcMain.handle(
    RepoChannels.renameBranch,
    async (
      _event,
      repoPath: unknown,
      oldName: unknown,
      newName: unknown,
    ): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      const from = typeof oldName === 'string' ? oldName : '';
      // Keep the new name to a safe, ref-legal slug so it can't inject flags/paths.
      const to = typeof newName === 'string' ? newName.trim() : '';
      if (!from) {
        return { status: 'error', message: 'No branch was specified.' };
      }
      if (!to || !/^[A-Za-z0-9._/-]+$/.test(to) || to.startsWith('-')) {
        return { status: 'error', message: 'Enter a valid branch name.' };
      }
      // Re-validate against the repo's own state: the source must exist, and the
      // destination must be free (unless it's an unchanged rename, which git no-ops).
      if (!(await localBranchExists(repoPath, from))) {
        return { status: 'error', message: `Branch “${from}” doesn’t exist.` };
      }
      if (to !== from && (await localBranchExists(repoPath, to))) {
        return { status: 'error', message: `Branch “${to}” already exists.` };
      }
      // `git branch -m <old> <new>` renames in place (and moves HEAD's ref when it's
      // the checked-out branch). Both names are validated above, so neither can be
      // read as a flag.
      return mutateRepo(
        repoPath,
        [['branch', '-m', from, to]],
        `Could not rename “${from}”.`,
      );
    },
  );

  ipcMain.handle(
    RepoChannels.deleteBranch,
    async (_event, repoPath: unknown, branch: unknown): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      if (typeof branch !== 'string' || branch.length === 0) {
        return { status: 'error', message: 'No branch was specified.' };
      }
      // Re-validate against the repo's own state: the branch must exist locally,
      // and must not be the checked-out one (git refuses, and it's a footgun).
      if (!(await localBranchExists(repoPath, branch))) {
        return { status: 'error', message: `Branch “${branch}” doesn’t exist.` };
      }
      if ((await currentBranchName(repoPath)) === branch) {
        return {
          status: 'error',
          message: `“${branch}” is checked out. Switch to another branch, then delete it.`,
        };
      }
      // `-D` force-deletes: the user confirmed in the UI, so we don't want git to
      // block on "not fully merged". `--` terminates options; the name can't be a flag.
      return mutateRepo(
        repoPath,
        [['branch', '-D', '--', branch]],
        `Could not delete “${branch}”.`,
      );
    },
  );

  ipcMain.handle(
    RepoChannels.deleteRemoteBranch,
    async (
      _event,
      repoPath: unknown,
      remote: unknown,
      branch: unknown,
    ): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      if (typeof remote !== 'string' || typeof branch !== 'string' || branch.length === 0) {
        return { status: 'error', message: 'No branch was specified.' };
      }
      // The remote must be one the repo actually has configured.
      const remotes = new Set(nonEmptyLines(await runGit(repoPath, ['remote'])));
      if (!remotes.has(remote)) {
        return { status: 'error', message: `Unknown remote “${remote}”.` };
      }
      // `git push <remote> --delete <branch>` removes the branch on the remote and
      // prunes the local remote-tracking ref. It hits the network, so use the
      // push error mapper and keep GIT_TERMINAL_PROMPT=0 (via mutateRepo's env).
      const env = gitEnv({ GIT_TERMINAL_PROMPT: '0' });
      const authArgs = await authArgsForRemotes(repoPath, [remote]);
      const sshEnv = await sshEnvForRemotes(repoPath, [remote]);
      try {
        await execFileAsync(
          gitBin,
          [...authArgs, 'push', remote, '--delete', '--', branch],
          { cwd: repoPath, env: { ...env, ...sshEnv } },
        );
      } catch (err) {
        return { status: 'error', message: pushErrorMessage(err) };
      }
      return { status: 'ok', refs: await readRefs(repoPath) };
    },
  );

  ipcMain.handle(
    RepoChannels.merge,
    async (
      _event,
      repoPath: unknown,
      source: unknown,
      target: unknown,
    ): Promise<RefsMutationResult> => {
      const invalid = await validateBranchPair(repoPath, source, target);
      if (invalid) return { status: 'error', message: invalid };
      // Land the merge on `target`: switch to it, then merge `source` in. A
      // conflicting merge aborts and surfaces git's message.
      return integrateBranch(
        repoPath as string,
        target as string,
        source as string,
        'merge',
        `Could not merge “${source as string}” into “${target as string}”.`,
      );
    },
  );

  ipcMain.handle(
    RepoChannels.rebase,
    async (
      _event,
      repoPath: unknown,
      source: unknown,
      target: unknown,
    ): Promise<RefsMutationResult> => {
      const invalid = await validateBranchPair(repoPath, source, target);
      if (invalid) return { status: 'error', message: invalid };
      // Switch to `target`, then replay its commits on top of `source`. A
      // conflicting rebase aborts and surfaces git's message.
      return integrateBranch(
        repoPath as string,
        target as string,
        source as string,
        'rebase',
        `Could not rebase “${source as string}” into “${target as string}”.`,
      );
    },
  );

  ipcMain.handle(
    RepoChannels.stashPush,
    async (_event, repoPath: unknown): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      // Default the stash message to "WIP on <branch>". On a detached HEAD there
      // is no branch, so omit -m and let git use its own default message.
      const branch = await currentBranchName(repoPath);
      const args = ['stash', 'push', '--include-untracked'];
      if (branch) args.push('-m', `WIP on ${branch}`);
      return mutateRepo(repoPath, [args], 'Could not stash your changes.');
    },
  );

  ipcMain.handle(
    RepoChannels.stashApply,
    async (_event, repoPath: unknown, index: unknown): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        return { status: 'error', message: 'Invalid stash.' };
      }
      return mutateRepo(
        repoPath,
        [['stash', 'apply', `stash@{${index}}`]],
        'Could not apply the stash.',
      );
    },
  );

  ipcMain.handle(
    RepoChannels.stashPop,
    async (_event, repoPath: unknown, index: unknown): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        return { status: 'error', message: 'Invalid stash.' };
      }
      return mutateRepo(
        repoPath,
        [['stash', 'pop', `stash@{${index}}`]],
        'Could not apply the stash.',
      );
    },
  );

  ipcMain.handle(
    RepoChannels.stashDrop,
    async (_event, repoPath: unknown, index: unknown): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        return { status: 'error', message: 'Invalid stash.' };
      }
      return mutateRepo(
        repoPath,
        [['stash', 'drop', `stash@{${index}}`]],
        'Could not drop the stash.',
      );
    },
  );

  ipcMain.handle(
    RepoChannels.worktreeAdd,
    async (
      _event,
      repoPath: unknown,
      options: unknown,
    ): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      const opts = (options ?? {}) as Partial<WorktreeAddOptions>;
      const treePath = typeof opts.path === 'string' ? opts.path.trim() : '';
      // The path is used as a positional arg; reject a leading dash so it can't be
      // read as a flag, and require it not already exist (git refuses anyway, but
      // this gives a clearer message).
      if (!treePath || treePath.startsWith('-')) {
        return { status: 'error', message: 'Choose a location for the worktree.' };
      }
      if (fs.existsSync(treePath)) {
        return {
          status: 'error',
          message: 'That location already exists — pick a new folder name.',
        };
      }
      // Keep the branch name ref-legal so it can't inject a flag, matching the
      // create-branch handler.
      const branch = typeof opts.branch === 'string' ? opts.branch.trim() : '';
      if (!branch || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('-')) {
        return { status: 'error', message: 'Enter a valid branch name.' };
      }
      // A branch that already exists locally is simply checked out in the new
      // worktree; git refuses one already open in another worktree, surfaced as an
      // error.
      if (await localBranchExists(repoPath, branch)) {
        return mutateRepo(
          repoPath,
          [['worktree', 'add', treePath, branch]],
          `Could not add a worktree for “${branch}”.`,
        );
      }
      // Otherwise create the branch off the chosen start-point — a local branch
      // (`dev`) or a remote-tracking one (`origin/dev`), from which git sets up
      // tracking automatically. The start-point comes from the repo's own ref
      // list; validate it resolves to a commit before use.
      const startPoint = typeof opts.startPoint === 'string' ? opts.startPoint.trim() : '';
      if (
        !startPoint ||
        !/^[A-Za-z0-9._/-]+$/.test(startPoint) ||
        startPoint.startsWith('-')
      ) {
        return { status: 'error', message: 'Choose a branch to base the worktree on.' };
      }
      if (!(await commitishExists(repoPath, startPoint))) {
        return { status: 'error', message: `“${startPoint}” doesn’t exist.` };
      }
      return mutateRepo(
        repoPath,
        [['worktree', 'add', '-b', branch, treePath, startPoint]],
        `Could not create the worktree for “${branch}”.`,
      );
    },
  );

  ipcMain.handle(
    RepoChannels.worktreeRemove,
    async (
      _event,
      repoPath: unknown,
      worktreePath: unknown,
      options: unknown,
    ): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      const treePath = typeof worktreePath === 'string' ? worktreePath.trim() : '';
      if (!treePath || treePath.startsWith('-')) {
        return { status: 'error', message: 'No worktree was specified.' };
      }
      const opts = (options ?? {}) as { force?: boolean; deleteBranch?: boolean };
      const removeArgs = ['worktree', 'remove'];
      if (opts.force === true) removeArgs.push('--force');
      removeArgs.push(treePath);
      const steps: string[][] = [removeArgs];

      // When removing the worktree we're running from, its directory (our cwd) is
      // deleted by the remove step — so a follow-up `git branch -D`, and the final
      // refs read, would fail with "cannot change to '…': No such file or
      // directory". Run the steps from the main worktree instead, which survives.
      const removingSelf = normalizePath(repoPath) === normalizePath(treePath);
      let cwd = repoPath;
      if (opts.deleteBranch === true || removingSelf) {
        const trees = await readWorktrees(repoPath);
        if (removingSelf) cwd = trees.find((tree) => tree.isMain)?.path ?? repoPath;
        // Optionally delete the branch the worktree had checked out — resolved from
        // the repo's own worktree list, deleted *after* the worktree is gone (so
        // it's no longer checked out). A detached worktree has no branch to drop.
        if (opts.deleteBranch === true) {
          const branch = trees.find(
            (tree) => normalizePath(tree.path) === normalizePath(treePath),
          )?.branch;
          if (branch) steps.push(['branch', '-D', branch]);
        }
      }
      return mutateRepo(cwd, steps, 'Could not remove the worktree.');
    },
  );

  ipcMain.handle(
    RepoChannels.worktreeLock,
    async (
      _event,
      repoPath: unknown,
      worktreePath: unknown,
      lock: unknown,
      reason: unknown,
    ): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      const treePath = typeof worktreePath === 'string' ? worktreePath.trim() : '';
      if (!treePath || treePath.startsWith('-')) {
        return { status: 'error', message: 'No worktree was specified.' };
      }
      if (lock !== true) {
        return mutateRepo(
          repoPath,
          [['worktree', 'unlock', treePath]],
          'Could not unlock the worktree.',
        );
      }
      const args = ['worktree', 'lock'];
      // An optional reason recorded with the lock. `--reason` takes it as its own
      // value (array args, no shell), so it's safe as free text; cap the length.
      const why = typeof reason === 'string' ? reason.trim() : '';
      if (why) args.push('--reason', why.slice(0, 500));
      args.push(treePath);
      return mutateRepo(repoPath, [args], 'Could not lock the worktree.');
    },
  );

  ipcMain.handle(
    RepoChannels.isWorktree,
    async (_event, repoPath: unknown): Promise<boolean> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return false;
      return isLinkedWorktree(repoPath);
    },
  );

  ipcMain.handle(
    RepoChannels.pathInsideWorktree,
    async (_event, target: unknown): Promise<boolean> => {
      if (typeof target !== 'string' || target.length === 0) return false;
      // Walk up to the nearest ancestor that exists on disk (the target itself
      // usually doesn't yet), then ask git whether that directory is inside a work
      // tree. `--is-inside-work-tree` prints "true" only within a checkout.
      let dir = path.resolve(target);
      while (!fs.existsSync(dir)) {
        const parent = path.dirname(dir);
        if (parent === dir) return false;
        dir = parent;
      }
      const out = await runGit(dir, ['rev-parse', '--is-inside-work-tree']);
      return out.trim() === 'true';
    },
  );

  ipcMain.handle(
    RepoChannels.gitflowConfig,
    async (_event, repoPath: unknown): Promise<GitflowConfig | null> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return null;
      return readGitflowConfig(repoPath);
    },
  );

  ipcMain.handle(
    RepoChannels.gitflowSaveConfig,
    async (_event, repoPath: unknown, config: unknown): Promise<GitflowConfigResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      if (!config || typeof config !== 'object') {
        return { status: 'error', message: 'Invalid gitflow settings.' };
      }
      const raw = config as Record<keyof GitflowConfig, unknown>;
      const fields: { key: keyof GitflowConfig; label: string }[] = [
        { key: 'mainBranch', label: 'main branch' },
        { key: 'developBranch', label: 'develop branch' },
        { key: 'featurePrefix', label: 'feature prefix' },
        { key: 'releasePrefix', label: 'release prefix' },
        { key: 'hotfixPrefix', label: 'hotfix prefix' },
      ];
      const valid: GitflowConfig = { ...GITFLOW_DEFAULTS };
      for (const { key, label } of fields) {
        const value = typeof raw[key] === 'string' ? (raw[key] as string).trim() : '';
        if (!isGitflowValue(value)) {
          return { status: 'error', message: `Enter a valid ${label}.` };
        }
        valid[key] = value;
      }
      // Write each key to the repo's git config. These are local config writes,
      // not ref mutations, so they don't go through mutateRepo.
      const env = gitEnv({ GIT_TERMINAL_PROMPT: '0' });
      try {
        for (const key of Object.keys(GITFLOW_CONFIG_KEYS) as (keyof GitflowConfig)[]) {
          await execFileAsync(gitBin, ['config', GITFLOW_CONFIG_KEYS[key], valid[key]], {
            cwd: repoPath,
            env,
          });
        }
      } catch (err) {
        return { status: 'error', message: gitErrorMessage(err, 'Could not save gitflow settings.') };
      }
      return { status: 'ok', config: valid };
    },
  );

  ipcMain.handle(
    RepoChannels.gitflowStart,
    async (
      _event,
      repoPath: unknown,
      kind: unknown,
      name: unknown,
      source: unknown,
    ): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      if (kind !== 'feature' && kind !== 'release' && kind !== 'hotfix') {
        return { status: 'error', message: 'Unknown gitflow branch kind.' };
      }
      // Keep the name to a safe, ref-legal slug so it can't inject flags/paths.
      const slug = typeof name === 'string' ? name.trim() : '';
      if (!slug || !/^[A-Za-z0-9._/-]+$/.test(slug) || slug.startsWith('-')) {
        return { status: 'error', message: 'Enter a valid branch name.' };
      }
      const config = (await readGitflowConfig(repoPath)) ?? GITFLOW_DEFAULTS;
      const branch = `${gitflowPrefix(config, kind)}${slug}`;
      if (await localBranchExists(repoPath, branch)) {
        return { status: 'error', message: `Branch “${branch}” already exists.` };
      }
      // Base the branch on the caller's chosen source when given (validated as a
      // real ref so it can't inject flags/paths); otherwise fall back to the
      // configured base — develop for feature/release, main for hotfix — then the
      // conventional names, then the current HEAD.
      let base: string | null;
      const picked = typeof source === 'string' ? source.trim() : '';
      if (picked) {
        if (
          picked.startsWith('-') ||
          !/^[A-Za-z0-9._/-]+$/.test(picked) ||
          !(await refExists(repoPath, picked))
        ) {
          return { status: 'error', message: 'Choose a valid source branch.' };
        }
        base = picked;
      } else {
        const bases =
          kind === 'hotfix'
            ? [config.mainBranch, 'main', 'master']
            : [config.developBranch, 'develop'];
        base = await firstExistingBranch(repoPath, bases);
      }
      const args = base
        ? ['checkout', '-b', branch, base]
        : ['checkout', '-b', branch];
      return mutateRepo(repoPath, [args], `Could not start “${branch}”.`);
    },
  );

  ipcMain.handle(
    RepoChannels.gitflowFinish,
    async (_event, repoPath: unknown): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      const config = (await readGitflowConfig(repoPath)) ?? GITFLOW_DEFAULTS;
      const branch = await currentBranchName(repoPath);
      const kind = gitflowKindOf(config, branch);
      if (!kind) {
        return {
          status: 'error',
          message: 'Not on a gitflow branch (feature/…, release/…, hotfix/…).',
        };
      }
      const bases =
        kind === 'hotfix'
          ? [config.mainBranch, 'main', 'master']
          : [config.developBranch, 'develop'];
      const base = await firstExistingBranch(repoPath, bases);
      if (!base) {
        return {
          status: 'error',
          message: `No base branch (${gitflowBase(config, kind)}) to finish “${branch}” into.`,
        };
      }
      // Switch to the base, merge the topic branch with a merge commit, then
      // delete it. A conflicting merge aborts and surfaces git's message.
      return mutateRepo(
        repoPath,
        [
          ['checkout', base],
          ['merge', '--no-ff', branch],
          ['branch', '-d', branch],
        ],
        `Could not finish “${branch}”.`,
      );
    },
  );

  ipcMain.handle(
    RepoChannels.mergeState,
    async (_event, repoPath: unknown): Promise<MergeState | null> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) return null;
      return readMergeState(repoPath);
    },
  );

  ipcMain.handle(
    RepoChannels.conflictFile,
    async (_event, repoPath: unknown, file: unknown): Promise<ConflictFileContent> => {
      const empty: ConflictFileContent = {
        path: typeof file === 'string' ? file : '',
        binary: false,
        base: null,
        ours: null,
        theirs: null,
        merged: [],
      };
      if (
        typeof repoPath !== 'string' ||
        !isGitRepo(repoPath) ||
        typeof file !== 'string' ||
        file.length === 0
      ) {
        return empty;
      }
      return readConflictFile(repoPath, file);
    },
  );

  ipcMain.handle(
    RepoChannels.resolveFile,
    async (
      _event,
      repoPath: unknown,
      file: unknown,
      resolution: unknown,
    ): Promise<MergeState | null> => {
      if (
        typeof repoPath !== 'string' ||
        !isGitRepo(repoPath) ||
        typeof file !== 'string' ||
        file.length === 0
      ) {
        return null;
      }
      const res = asMergeResolution(resolution);
      if (res === null) return readMergeState(repoPath);
      try {
        return await resolveConflictFile(repoPath, file, res);
      } catch {
        return readMergeState(repoPath);
      }
    },
  );

  ipcMain.handle(
    RepoChannels.markResolved,
    async (
      _event,
      repoPath: unknown,
      file: unknown,
    ): Promise<MarkResolvedResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: emptyStatus, merge: null };
      }
      // Stage the conflicted file(s) as-is; `git add` clears their unmerged
      // state, which is how git records a conflict as resolved. A specific path
      // resolves one file; null resolves every conflict at once.
      const args =
        typeof file === 'string' && file.length > 0
          ? ['add', '-A', '--', file]
          : ['add', '-A'];
      await runGit(repoPath, args);
      return { status: await readStatus(repoPath), merge: await readMergeState(repoPath) };
    },
  );

  ipcMain.handle(
    RepoChannels.mergeContinue,
    async (_event, repoPath: unknown): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      return continueOperation(repoPath);
    },
  );

  ipcMain.handle(
    RepoChannels.mergeAbort,
    async (_event, repoPath: unknown): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      return abortOperation(repoPath);
    },
  );

  ipcMain.handle(
    RepoChannels.rebaseSkip,
    async (_event, repoPath: unknown): Promise<RefsMutationResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      return skipRebaseStep(repoPath);
    },
  );

  ipcMain.handle(
    RepoChannels.open,
    async (event): Promise<OpenRepoResult> => {
      // Anchor the picker to the requesting window so it opens as a sheet on
      // macOS rather than a detached, unowned dialog.
      const win = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: 'Open Repository',
        properties: ['openDirectory'],
      };
      // Reopen where the user last browsed (e.g. after a wrong pick) instead of
      // the OS default. Skip a stale path that no longer exists on disk.
      if (settings.lastRepoDir && fs.existsSync(settings.lastRepoDir)) {
        options.defaultPath = settings.lastRepoDir;
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);

      if (result.canceled || result.filePaths.length === 0) {
        return { status: 'canceled' };
      }

      const dir = result.filePaths[0];
      // Remember the containing folder so a retry lands on the same listing,
      // regardless of whether this pick turned out to be a repository.
      settings.lastRepoDir = path.dirname(dir);
      saveSettings();

      if (!isGitRepo(dir)) {
        return { status: 'not-a-repo', path: dir };
      }
      return { status: 'opened', repo: { name: path.basename(dir), path: dir } };
    },
  );

  ipcMain.handle(
    RepoChannels.chooseDir,
    async (event): Promise<string | null> => {
      // Anchor to the requesting window so it opens as a sheet on macOS.
      const win = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: 'Choose Destination Folder',
        buttonLabel: 'Select',
        // Let the user create the target folder inline while picking.
        properties: ['openDirectory', 'createDirectory'],
      };
      // Reopen where they last chose a destination, if it still exists.
      if (settings.lastCloneDir && fs.existsSync(settings.lastCloneDir)) {
        options.defaultPath = settings.lastCloneDir;
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const dir = result.filePaths[0];
      settings.lastCloneDir = dir;
      saveSettings();
      return dir;
    },
  );

  ipcMain.handle(RepoChannels.lastCloneDir, (): string | null => {
    const dir = settings.lastCloneDir;
    // Only offer it if it still exists, so a pre-filled path is never stale.
    return dir && fs.existsSync(dir) ? dir : null;
  });

  ipcMain.handle(RepoChannels.recent, (): RecentRepo[] => {
    const stored = settings.recentRepos ?? [];
    // Drop entries whose folder no longer exists so the list stays trustworthy,
    // and persist the pruning so stale paths don't linger.
    const existing = stored.filter((repo) => fs.existsSync(repo.path));
    if (existing.length !== stored.length) {
      settings.recentRepos = existing;
      saveSettings();
    }
    return [...existing].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  });

  ipcMain.handle(
    RepoChannels.record,
    (_event, repo: RepoInfo): RecentRepo[] => {
      if (
        !repo ||
        typeof repo.name !== 'string' ||
        typeof repo.path !== 'string'
      ) {
        throw new Error('Invalid repository payload');
      }
      // Carry over an existing star so re-opening a favorite keeps it pinned.
      const previous = (settings.recentRepos ?? []).find(
        (item) => item.path === repo.path,
      );
      const entry: RecentRepo = {
        name: repo.name,
        path: repo.path,
        lastOpenedAt: Date.now(),
        favorite: previous?.favorite ?? false,
      };
      // De-duplicate by path so a repo appears once and moves to the front,
      // then cap the list length.
      const others = (settings.recentRepos ?? []).filter(
        (item) => item.path !== repo.path,
      );
      settings.recentRepos = [entry, ...others].slice(0, MAX_RECENT_REPOS);
      saveSettings();
      return [...settings.recentRepos];
    },
  );

  ipcMain.handle(
    RepoChannels.forget,
    (_event, repoPath: string): RecentRepo[] => {
      if (typeof repoPath !== 'string') {
        throw new Error('Invalid repository path');
      }
      settings.recentRepos = (settings.recentRepos ?? []).filter(
        (item) => item.path !== repoPath,
      );
      saveSettings();
      return [...settings.recentRepos].sort(
        (a, b) => b.lastOpenedAt - a.lastOpenedAt,
      );
    },
  );

  ipcMain.handle(
    RepoChannels.setFavorite,
    (_event, repoPath: string, favorite: boolean): RecentRepo[] => {
      if (typeof repoPath !== 'string' || typeof favorite !== 'boolean') {
        throw new Error('Invalid favorite payload');
      }
      settings.recentRepos = (settings.recentRepos ?? []).map((item) =>
        item.path === repoPath ? { ...item, favorite } : item,
      );
      saveSettings();
      return [...settings.recentRepos].sort(
        (a, b) => b.lastOpenedAt - a.lastOpenedAt,
      );
    },
  );

  ipcMain.handle(RepoChannels.openTabs, (): OpenTabsState => {
    // Prune paths that are gone / no longer git repos so a stale tab can't
    // reopen into a broken view, and persist the pruning.
    const stored = settings.openTabs ?? [];
    const existing = stored.filter(
      (p) => fs.existsSync(p) && isGitRepo(p),
    );
    if (existing.length !== stored.length) {
      settings.openTabs = existing;
      saveSettings();
    }
    // Resolve the active tab by path (ids are ephemeral, and pruning can shift
    // indices); fall back to the first tab when it's gone or was an empty tab.
    const activeIndex = settings.activeTab
      ? Math.max(existing.indexOf(settings.activeTab), 0)
      : 0;
    return { paths: [...existing], activeIndex };
  });

  ipcMain.handle(
    RepoChannels.saveOpenTabs,
    (_event, paths: unknown, activePath: unknown): void => {
      if (!Array.isArray(paths)) {
        throw new Error('Invalid open-tabs payload');
      }
      settings.openTabs = paths.filter(
        (p): p is string => typeof p === 'string',
      );
      settings.activeTab =
        typeof activePath === 'string' ? activePath : undefined;
      saveSettings();
    },
  );

  ipcMain.handle(
    RepoChannels.clone,
    (event, request: CloneRequest): Promise<CloneResult> => {
      const url = typeof request?.url === 'string' ? request.url.trim() : '';
      const destination =
        typeof request?.destination === 'string' ? request.destination : '';

      if (!url) {
        return Promise.resolve({
          status: 'error',
          message: 'No repository URL was provided.',
        });
      }
      if (!destination || !fs.existsSync(destination)) {
        return Promise.resolve({
          status: 'error',
          message: 'The destination folder does not exist.',
        });
      }
      // Use the requested folder name when given, otherwise derive it from the
      // URL. Strip path separators so the clone can't escape the destination.
      const requested =
        typeof request?.directory === 'string'
          ? request.directory.trim().replace(/[/\\]/g, '')
          : '';
      const name = requested || repoNameFromUrl(url);
      const target = path.join(destination, name);
      if (fs.existsSync(target)) {
        return Promise.resolve({
          status: 'error',
          message: `A folder named “${name}” already exists here.`,
        });
      }

      // Embed the matching provider's token into the URL; keep it for redaction.
      const { url: cloneUrl, token } = authenticatedCloneUrl(url);
      // For an SSH clone URL, authenticate with our own generated key instead of
      // the ssh agent's (mirrors push/pull); null for HTTPS/unmanaged hosts.
      const sshCommand = sshCommandForUrl(url);
      const sender = event.sender;

      return new Promise<CloneResult>((resolve) => {
        // Array args (no shell) avoid injection; `--` stops the URL/target from
        // being read as options; the protocol allow-list blocks git's local
        // command-exec transports (ext::/fd::). GIT_TERMINAL_PROMPT=0 makes an
        // unauthorized clone fail fast instead of hanging on a prompt.
        const child = spawn(
          gitBin,
          ['clone', '--progress', '--', cloneUrl, target],
          {
            env: gitEnv({
              GIT_TERMINAL_PROMPT: '0',
              GIT_ALLOW_PROTOCOL: 'https:http:git:ssh:file',
              ...(sshCommand ? { GIT_SSH_COMMAND: sshCommand } : {}),
            }),
          },
        );

        const running: RunningClone = { child, target, canceled: false };
        runningClones.set(sender.id, running);

        let lastLine = '';
        const consume = (buffer: Buffer) => {
          // git writes progress as \r-updated lines on stderr.
          for (const raw of buffer.toString().split(/[\r\n]+/)) {
            const line = raw.trim();
            if (!line) continue;
            lastLine = line;
            const match = line.match(/(\d+)%/);
            const progress: CloneProgress = {
              phase: redactSecrets(line, token),
              percent: match ? Number(match[1]) : undefined,
            };
            if (!sender.isDestroyed()) {
              sender.send(RepoChannels.cloneProgress, progress);
            }
          }
        };
        child.stderr.on('data', consume);
        child.stdout.on('data', consume);

        child.on('error', (err) => {
          runningClones.delete(sender.id);
          resolve({
            status: 'error',
            message: `Could not run git (${err.message}). Is Git installed and on your PATH?`,
          });
        });
        child.on('close', (code) => {
          runningClones.delete(sender.id);
          if (running.canceled) {
            // Remove the half-written clone, then report cancellation.
            fs.rm(target, { recursive: true, force: true }, () =>
              resolve({ status: 'canceled' }),
            );
          } else if (code === 0) {
            resolve({ status: 'cloned', repo: { name, path: target } });
          } else {
            resolve({
              status: 'error',
              message: redactSecrets(
                lastLine || `git clone exited with code ${code ?? 'unknown'}.`,
                token,
              ),
            });
          }
        });
      });
    },
  );

  ipcMain.handle(RepoChannels.cloneCancel, (event): void => {
    const running = runningClones.get(event.sender.id);
    if (running) {
      // Flag first so `close` cleans up and reports cancellation, then stop git.
      running.canceled = true;
      running.child.kill('SIGTERM');
    }
  });
}

// ---- Integrations ---------------------------------------------------------

// Durable connection metadata (which accounts are linked) lives in settings;
// the access tokens live encrypted in a separate file. These two maps hold the
// purely transient bits that must never be persisted: an in-flight flow and the
// last failed attempt's message.
const connectingProviders = new Set<IntegrationProvider>();
const connectErrors = new Map<IntegrationProvider, string>();
/** Abort controllers for in-flight device flows, so disconnect can cancel them. */
const pendingConnects = new Map<IntegrationProvider, AbortController>();

const tokensPath = () =>
  path.join(app.getPath('userData'), 'integration-tokens.json');

/** Read the on-disk map of provider -> base64(safeStorage-encrypted token). */
function loadTokenStore(): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(tokensPath(), 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, string>;
    }
  } catch {
    // No tokens yet, or the file is unreadable — treat as empty.
  }
  return {};
}

function saveTokenStore(store: Record<string, string>): void {
  try {
    fs.writeFileSync(tokensPath(), JSON.stringify(store), 'utf-8');
    // Best effort: keep the token file readable only by its owner.
    try {
      fs.chmodSync(tokensPath(), 0o600);
    } catch {
      // chmod is unsupported on some platforms (e.g. Windows) — ignore.
    }
  } catch (err) {
    console.error('Failed to persist integration tokens:', err);
  }
}

/** Seal a token with the OS keychain and persist it. Throws if unavailable. */
function storeToken(provider: IntegrationProvider, token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is unavailable, so the token was not saved.');
  }
  const store = loadTokenStore();
  store[provider] = safeStorage.encryptString(token).toString('base64');
  saveTokenStore(store);
}

function clearToken(provider: IntegrationProvider): void {
  const store = loadTokenStore();
  if (provider in store) {
    delete store[provider];
    saveTokenStore(store);
  }
}

function hasToken(provider: IntegrationProvider): boolean {
  return provider in loadTokenStore();
}

/** Decrypt and return a stored token, or null if absent/unreadable. */
function getToken(provider: IntegrationProvider): string | null {
  const encrypted = loadTokenStore()[provider];
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    // Corrupt entry or a different keychain (e.g. after an OS user change).
    return null;
  }
}

/** The connection to report for one provider, merging durable + transient bits. */
function connectionOf(provider: IntegrationProvider): IntegrationConnection {
  if (connectingProviders.has(provider)) {
    return { provider, status: 'connecting' };
  }
  const persisted = settings.integrations?.[provider];
  if (persisted?.status === 'connected') {
    return {
      provider,
      status: 'connected',
      account: persisted.account,
      name: persisted.name,
      avatarUrl: persisted.avatarUrl,
    };
  }
  const error = connectErrors.get(provider);
  return { provider, status: 'disconnected', ...(error ? { error } : {}) };
}

function integrationsState(): IntegrationsState {
  return {
    github: connectionOf('github'),
    gitlab: connectionOf('gitlab'),
  };
}

/** Push the current connection state to every open window. */
function broadcastIntegrations(): void {
  const state = integrationsState();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IntegrationChannels.changed, state);
  }
}

/**
 * Drop any persisted connection whose token has gone missing (e.g. the tokens
 * file was deleted), so a restart never claims to be connected without a token.
 */
function reconcileIntegrations(): void {
  if (!settings.integrations) return;
  const next = { ...settings.integrations };
  let changed = false;
  for (const provider of INTEGRATION_PROVIDERS) {
    const entry = next[provider];
    if (entry && (entry.status !== 'connected' || !hasToken(provider))) {
      delete next[provider];
      changed = true;
    }
  }
  if (changed) {
    settings.integrations = next;
    saveSettings();
  }
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** User-facing provider names for messages. */
const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
};

/**
 * Kick off a provider's device flow: fetch a user code, open the browser, and
 * start polling in the background. Resolves with the prompt to show the user;
 * the connection completes later and is announced via `integrations:changed`.
 */
async function startConnect(
  provider: IntegrationProvider,
): Promise<DeviceCodePrompt> {
  const client = PROVIDER_CLIENTS[provider];
  const label = PROVIDER_LABELS[provider];
  if (!client.clientId) {
    throw new Error(
      `${label} sign-in is not configured. Set ${provider.toUpperCase()}_CLIENT_ID ` +
        'to an OAuth application client id with device flow enabled.',
    );
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure token storage is unavailable on this system.');
  }

  // Cancel any previous attempt for this provider before starting a new one.
  pendingConnects.get(provider)?.abort();
  const controller = new AbortController();
  pendingConnects.set(provider, controller);
  connectErrors.delete(provider);

  let auth: DeviceAuthorization;
  try {
    auth = await client.requestDeviceAuthorization(
      client.clientId,
      client.scope,
      controller.signal,
    );
  } catch (err) {
    pendingConnects.delete(provider);
    throw new Error(messageOf(err, `Could not reach ${label} to sign in.`));
  }

  connectingProviders.add(provider);
  broadcastIntegrations();

  // Open the verification page in the user's real browser — with the code
  // pre-filled when the host provides that URL. If it fails to launch, the
  // returned prompt still shows the URL and code to enter manually.
  void shell
    .openExternal(auth.verificationUriComplete ?? auth.verificationUri)
    .catch(() => undefined);

  // Poll in the background; don't block the connect() response on it.
  void completeConnect(provider, auth, controller);

  return {
    provider,
    userCode: auth.userCode,
    verificationUri: auth.verificationUri,
    expiresIn: auth.expiresIn,
  };
}

async function completeConnect(
  provider: IntegrationProvider,
  auth: DeviceAuthorization,
  controller: AbortController,
): Promise<void> {
  const client = PROVIDER_CLIENTS[provider];
  try {
    const token = await client.pollForAccessToken(
      client.clientId,
      auth,
      controller.signal,
    );
    const account = await client.fetchAccount(token, controller.signal);
    storeToken(provider, token);
    settings.integrations = {
      ...settings.integrations,
      [provider]: {
        provider,
        status: 'connected',
        account: account.username,
        name: account.name,
        avatarUrl: account.avatarUrl,
      },
    };
    saveSettings();
  } catch (err) {
    // A cancel (disconnect) aborts the flow; that path already broadcast the
    // disconnected state, so don't surface it as an error.
    if (!controller.signal.aborted) {
      connectErrors.set(
        provider,
        messageOf(err, `${PROVIDER_LABELS[provider]} sign-in failed.`),
      );
    }
  } finally {
    connectingProviders.delete(provider);
    if (pendingConnects.get(provider) === controller) {
      pendingConnects.delete(provider);
    }
    broadcastIntegrations();
  }
}

/**
 * Write a freshly generated keypair under `~/.ssh`, creating the directory if
 * needed and locking the private key down to owner-only. Picks a non-colliding
 * name so an existing key is never overwritten. Returns the private key's path.
 */
function writeSshKeyToDisk(
  provider: IntegrationProvider,
  pair: { publicKey: string; privateKey: string },
): string {
  const sshDir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });

  const base = `gitleviathan_${provider}_ed25519`;
  let name = base;
  for (
    let n = 1;
    fs.existsSync(path.join(sshDir, name)) ||
    fs.existsSync(path.join(sshDir, `${name}.pub`));
    n++
  ) {
    name = `${base}_${n}`;
  }

  const privateKeyPath = path.join(sshDir, name);
  fs.writeFileSync(privateKeyPath, pair.privateKey, { mode: 0o600 });
  fs.writeFileSync(`${privateKeyPath}.pub`, `${pair.publicKey}\n`, {
    mode: 0o644,
  });
  // writeFileSync's mode is masked by the umask, so pin the private key down.
  try {
    fs.chmodSync(privateKeyPath, 0o600);
  } catch {
    // chmod is unsupported on some platforms (e.g. Windows) — ignore.
  }
  return privateKeyPath;
}

/**
 * Generate a new SSH key, upload its public half to the provider, and only then
 * persist the private half locally (so a failed upload leaves nothing behind).
 */
async function addSshKey(provider: IntegrationProvider): Promise<SshKeyInfo> {
  const token = getToken(provider);
  if (!token) {
    throw new Error(`${PROVIDER_LABELS[provider]} is not connected.`);
  }
  // One key per integration: revoke the existing one first before adding.
  if (settings.sshKeys?.[provider]?.length) {
    throw new Error(
      `An SSH key already exists for ${PROVIDER_LABELS[provider]}. Remove it first.`,
    );
  }
  const host = os.hostname().replace(/\.local$/, '');
  const date = new Date().toISOString().slice(0, 10);
  const title = `GitLeviathan (${host}) ${date}`;

  const pair = generateSshKeyPair(title);
  const remoteId = await PROVIDER_CLIENTS[provider].uploadSshKey(
    token,
    title,
    pair.publicKey,
  );
  const privateKeyPath = writeSshKeyToDisk(provider, pair);

  const info: SshKeyInfo = {
    provider,
    title,
    fingerprint: pair.fingerprint,
    fingerprintMd5: pair.fingerprintMd5,
    publicKey: pair.publicKey,
    privateKeyPath,
    remoteId,
    createdAt: Date.now(),
  };

  // Persist so the key reappears in Settings after the panel closes / restart.
  settings.sshKeys = {
    ...settings.sshKeys,
    [provider]: [info],
  };
  saveSettings();

  return info;
}

/**
 * Revoke a provider's SSH key: delete it on the provider, remove the private
 * key files from disk, and forget the record. Returns the remaining keys.
 */
async function removeSshKey(
  provider: IntegrationProvider,
): Promise<SshKeyInfo[]> {
  const keys = settings.sshKeys?.[provider] ?? [];
  const token = getToken(provider);

  for (const key of keys) {
    // Delete on the provider first; a failure here (other than "already gone",
    // which deleteSshKey swallows) aborts so the record isn't lost prematurely.
    if (token) {
      await PROVIDER_CLIENTS[provider].deleteSshKey(token, key.remoteId);
    }
    for (const file of [key.privateKeyPath, `${key.privateKeyPath}.pub`]) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // The file may already be gone or unremovable — best effort.
      }
    }
  }

  if (settings.sshKeys?.[provider]) {
    const next = { ...settings.sshKeys };
    delete next[provider];
    settings.sshKeys = next;
    saveSettings();
  }
  return settings.sshKeys?.[provider] ?? [];
}

function registerIntegrationsIpc(): void {
  ipcMain.handle(
    IntegrationChannels.list,
    (): IntegrationsState => integrationsState(),
  );

  ipcMain.handle(
    IntegrationChannels.connect,
    (_event, provider: IntegrationProvider): Promise<DeviceCodePrompt> => {
      if (!isIntegrationProvider(provider)) {
        throw new Error(`Unknown integration provider: ${String(provider)}`);
      }
      return startConnect(provider);
    },
  );

  ipcMain.handle(
    IntegrationChannels.disconnect,
    (_event, provider: IntegrationProvider): IntegrationsState => {
      if (!isIntegrationProvider(provider)) {
        throw new Error(`Unknown integration provider: ${String(provider)}`);
      }
      // Cancel an in-flight flow and forget the account + token entirely.
      pendingConnects.get(provider)?.abort();
      pendingConnects.delete(provider);
      connectingProviders.delete(provider);
      connectErrors.delete(provider);
      clearToken(provider);
      if (settings.integrations?.[provider]) {
        const next = { ...settings.integrations };
        delete next[provider];
        settings.integrations = next;
        saveSettings();
      }
      broadcastIntegrations();
      return integrationsState();
    },
  );

  ipcMain.handle(
    IntegrationChannels.repositories,
    (_event, provider: IntegrationProvider): Promise<RemoteRepo[]> => {
      if (!isIntegrationProvider(provider)) {
        throw new Error(`Unknown integration provider: ${String(provider)}`);
      }
      const token = getToken(provider);
      if (!token) {
        throw new Error(`${PROVIDER_LABELS[provider]} is not connected.`);
      }
      return PROVIDER_CLIENTS[provider].fetchUserRepos(token);
    },
  );

  ipcMain.handle(
    IntegrationChannels.pullRequests,
    async (_event, remoteUrl: unknown): Promise<PullRequestListResult> => {
      if (typeof remoteUrl !== 'string') {
        return { status: 'error', message: 'Invalid remote URL.' };
      }
      const host = parseRepoHost(remoteUrl);
      if (!host) return { status: 'unsupported' };
      const token = getToken(host.provider);
      if (!token) return { status: 'disconnected', provider: host.provider };
      try {
        const pulls = await PROVIDER_CLIENTS[host.provider].fetchPullRequests(
          token,
          host.owner,
          host.repo,
        );
        return { status: 'ok', host, pulls };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    IntegrationChannels.createPullRequest,
    async (
      _event,
      remoteUrl: unknown,
      input: unknown,
    ): Promise<CreatePullRequestResult> => {
      if (typeof remoteUrl !== 'string' || !isNewPullRequest(input)) {
        return { status: 'error', message: 'Invalid pull request details.' };
      }
      const host = parseRepoHost(remoteUrl);
      if (!host) {
        return {
          status: 'error',
          message: 'This remote is not a supported host (github.com / gitlab.com).',
        };
      }
      const token = getToken(host.provider);
      if (!token) {
        return {
          status: 'error',
          message: `${PROVIDER_LABELS[host.provider]} is not connected — connect it in Settings.`,
        };
      }
      try {
        const pull = await PROVIDER_CLIENTS[host.provider].createPullRequest(
          token,
          host.owner,
          host.repo,
          input,
        );
        return { status: 'ok', pull };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    IntegrationChannels.submitFeedback,
    async (_event, input: unknown): Promise<CreateIssueResult> => {
      if (!isNewFeedback(input)) {
        return { status: 'error', message: 'Invalid feedback details.' };
      }
      const token = getToken('github');
      if (!token) {
        return {
          status: 'error',
          message:
            'Connect a GitHub account in Settings to file a report — issues are created under your account.',
        };
      }
      const [owner, repo] = GITHUB_RELEASES_REPO.split('/');
      const label = input.kind === 'bug' ? 'bug' : 'feature';
      const prefix = input.kind === 'bug' ? '[Bug]' : '[Feature]';
      // Footer gives whoever triages the issue the build context automatically.
      const footer =
        `\n\n---\n_Reported from GitLeviathan v${app.getVersion()} ` +
        `on ${process.platform}._`;
      try {
        const issue = await github.createIssue(token, owner, repo, {
          title: `${prefix} ${input.title}`,
          body: input.details + footer,
          labels: [label],
        });
        return { status: 'ok', number: issue.number, url: issue.url };
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    IntegrationChannels.sshKeys,
    (_event, provider: IntegrationProvider): SshKeyInfo[] => {
      if (!isIntegrationProvider(provider)) {
        throw new Error(`Unknown integration provider: ${String(provider)}`);
      }
      return settings.sshKeys?.[provider] ?? [];
    },
  );

  ipcMain.handle(
    IntegrationChannels.addSshKey,
    (_event, provider: IntegrationProvider): Promise<SshKeyInfo> => {
      if (!isIntegrationProvider(provider)) {
        throw new Error(`Unknown integration provider: ${String(provider)}`);
      }
      return addSshKey(provider);
    },
  );

  ipcMain.handle(
    IntegrationChannels.removeSshKey,
    (_event, provider: IntegrationProvider): Promise<SshKeyInfo[]> => {
      if (!isIntegrationProvider(provider)) {
        throw new Error(`Unknown integration provider: ${String(provider)}`);
      }
      return removeSshKey(provider);
    },
  );
}

// ---- Dock icon ------------------------------------------------------------

/**
 * Show the app icon in the macOS dock during development. Packaged builds get
 * their icon from `packagerConfig.icon`, so this is only needed under
 * `electron-forge start`. Uses the rounded/padded macOS variant so the dev
 * dock matches the packaged icon (`assets/icon.icns`).
 */
function applyDockIcon(): void {
  if (process.platform !== 'darwin' || app.isPackaged || !app.dock) return;
  const icon = nativeImage.createFromPath(
    path.join(process.cwd(), 'assets', 'app_icon_macos.png'),
  );
  if (!icon.isEmpty()) app.dock.setIcon(icon);
}

// ---- Windows --------------------------------------------------------------

/**
 * Load a renderer's Vite dev-server URL, retrying on a failed navigation. In dev
 * the server can briefly refuse or 504 a request — right after launch before
 * it's accepting connections, or while it pre-bundles dependencies — which
 * otherwise strands the window on a blank error page that never recovers, then
 * gets revealed empty by the boot fallback (an empty app on roughly every other
 * `npm start`). A handful of retries rides over that window. ERR_ABORTED (-3) is
 * a superseded load — e.g. Vite's own full reload after optimizing — not a
 * failure, so it's ignored. Packaged builds use `loadFile` and never come here.
 */
function loadDevUrlWithRetry(win: BrowserWindow, url: string): void {
  const MAX_ATTEMPTS = 20;
  const RETRY_DELAY_MS = 250;
  let attempts = 0;
  const load = (): void => {
    if (win.isDestroyed()) return;
    // A rejected loadURL also fires `did-fail-load`; swallow it to avoid an
    // unhandled rejection and let the single retry path below drive re-loads.
    void win.loadURL(url).catch(() => undefined);
  };
  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, _desc, _validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || win.isDestroyed()) return;
      if (attempts++ < MAX_ATTEMPTS) setTimeout(load, RETRY_DELAY_MS);
    },
  );
  load();
}

function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 200,
    height: 400,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: preloadPath },
  });

  if (SPLASH_WINDOW_VITE_DEV_SERVER_URL) {
    loadDevUrlWithRetry(splash, SPLASH_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    splash.loadFile(
      path.join(__dirname, `../renderer/${SPLASH_WINDOW_VITE_NAME}/index.html`),
    );
  }

  splash.once('ready-to-show', () => splash.show());
  return splash;
}

function createMainWindow(): BrowserWindow {
  const saved = settings.windowBounds;
  const keepPosition = saved !== undefined && isPositionVisible(saved);

  const win = new BrowserWindow({
    width: saved?.width ?? DEFAULT_WINDOW.width,
    height: saved?.height ?? DEFAULT_WINDOW.height,
    x: keepPosition ? saved.x : undefined,
    y: keepPosition ? saved.y : undefined,
    center: !keepPosition,
    minWidth: 760,
    minHeight: 480,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e24' : '#f5f5f7',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: preloadPath,
      // Hand the app version to the preload synchronously (works packaged too,
      // where npm_package_version is absent). Read back off process.argv.
      additionalArguments: [`--app-version=${app.getVersion()}`],
      // The window boots hidden (show: false) behind the splash, and we reveal it
      // only once the renderer signals app:ready from a double requestAnimationFrame
      // (see main.tsx). Chromium throttles/pauses rAF and timers for hidden windows
      // by default, so that signal would fire late or not at all — leaving the
      // window stuck on the splash until the reveal fallback. Keep the hidden
      // window running at full speed so it paints and signals promptly.
      backgroundThrottling: false,
    },
  });

  if (settings.windowMaximized) {
    win.maximize();
  }

  // Tell the renderer each time the window regains OS focus, so it can re-sync
  // the on-screen repo with changes made outside the app (edits in an editor,
  // commits from a terminal) while it was in the background.
  win.on('focus', () => {
    if (!win.isDestroyed()) win.webContents.send(AppChannels.focused);
  });

  // Persist size/position (and maximized state) as they were on close.
  // getNormalBounds() returns the un-maximized bounds so a restore lands right.
  win.on('close', () => {
    settings.windowBounds = win.getNormalBounds();
    settings.windowMaximized = win.isMaximized();
    saveSettings();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    loadDevUrlWithRetry(win, MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return win;
}

/**
 * Hard cap on how long we wait for the renderer's ready signal before showing
 * the window anyway. Guards against the signal never arriving (e.g. a broken
 * renderer) so the app can't get stuck on the splash forever.
 */
const REVEAL_FALLBACK_MS = 10_000;

/** Show the splash, load the main window behind it, then hand off. */
function boot(): void {
  const splash = createSplashWindow();
  const shownAt = Date.now();
  const mainWindow = createMainWindow();

  let revealed = false;
  const reveal = (): void => {
    if (revealed || mainWindow.isDestroyed()) return;
    revealed = true;
    // Keep the splash up for at least MIN_SPLASH_MS so it never just flashes.
    const remaining = Math.max(0, MIN_SPLASH_MS - (Date.now() - shownAt));
    setTimeout(() => {
      if (mainWindow.isDestroyed()) return;
      if (!splash.isDestroyed()) {
        splash.close();
      }
      mainWindow.show();
      mainWindow.focus();
    }, remaining);
  };

  // Reveal only once the renderer has actually mounted and painted. Gating on
  // the React app — rather than `ready-to-show`, which fires on the empty HTML
  // shell — prevents revealing a blank window when the Vite dev server reloads
  // (e.g. after dependency pre-bundling) mid-boot.
  ipcMain.once(AppChannels.ready, (event) => {
    if (event.sender === mainWindow.webContents) {
      reveal();
    }
  });

  // Safety net: never leave the window stuck hidden if the signal is missed.
  setTimeout(() => reveal(), REVEAL_FALLBACK_MS);
}

/**
 * Local Claude Code integration. No token/OAuth: "connecting" detects the user's
 * own `claude` binary once and remembers its path in settings; its own auth does
 * the work. `status`/`connect`/`disconnect` back the Integrations settings row;
 * `generateCommitMessage` (which uses the saved path, no re-detection) backs the
 * commit panel.
 */
function registerClaudeIpc(): void {
  const currentStatus = (error?: string): ClaudeStatus => ({
    connected: Boolean(settings.claudeConnection),
    binaryPath: settings.claudeConnection?.binaryPath,
    version: settings.claudeConnection?.version,
    error,
  });

  ipcMain.handle(ClaudeChannels.status, (): ClaudeStatus => currentStatus());

  ipcMain.handle(
    ClaudeChannels.connect,
    async (): Promise<ClaudeStatus> => {
      const probe = await probeClaude(null);
      if (!probe.installed || !probe.binaryPath) {
        return currentStatus(
          'Claude Code was not found. Install it and sign in, then try again.',
        );
      }
      settings.claudeConnection = {
        binaryPath: probe.binaryPath,
        version: probe.version,
      };
      saveSettings();
      return currentStatus();
    },
  );

  ipcMain.handle(ClaudeChannels.disconnect, (): ClaudeStatus => {
    if (settings.claudeConnection) {
      delete settings.claudeConnection;
      saveSettings();
    }
    return currentStatus();
  });

  ipcMain.handle(
    ClaudeChannels.generateCommitMessage,
    async (_event, repoPath: unknown): Promise<GenerateCommitResult> => {
      if (typeof repoPath !== 'string' || !isGitRepo(repoPath)) {
        return { status: 'error', message: 'Not a git repository.' };
      }
      // Use the saved path directly — no per-click detection. A stale path
      // (binary moved/uninstalled) drops back to "not connected" so the user
      // is nudged to reconnect rather than shown a cryptic spawn error.
      const bin = settings.claudeConnection?.binaryPath;
      if (!bin || !isRunnable(bin)) {
        if (bin) {
          delete settings.claudeConnection;
          saveSettings();
        }
        return { status: 'not-connected' };
      }
      const diff = await runGitDiff(repoPath, ['diff', '--cached']);
      if (!diff.trim()) {
        return {
          status: 'error',
          message: 'Nothing staged to describe. Stage some changes first.',
        };
      }
      const recentSubjects = (
        await runGit(repoPath, ['log', '-n', '10', '--format=%s'])
      )
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      try {
        const { message } = await generateCommitMessage(
          bin,
          diff,
          recentSubjects,
          repoPath,
        );
        if (!message.trim()) {
          return { status: 'error', message: 'Claude returned an empty message.' };
        }
        return { status: 'ok', message: message.trim() };
      } catch (err) {
        return { status: 'error', message: claudeErrorMessage(err) };
      }
    },
  );
}

function registerAppIpc(): void {
  ipcMain.handle(
    AppChannels.getSidebarSections,
    (): Record<string, boolean> => ({ ...(settings.sidebarSections ?? {}) }),
  );

  ipcMain.handle(
    AppChannels.setSidebarSection,
    (_event, key: unknown, open: unknown): void => {
      if (typeof key !== 'string' || typeof open !== 'boolean') {
        throw new Error('Invalid sidebar section payload');
      }
      settings.sidebarSections = {
        ...(settings.sidebarSections ?? {}),
        [key]: open,
      };
      saveSettings();
    },
  );

  ipcMain.handle(
    AppChannels.getPullMode,
    (): PullMode => settings.pullMode ?? 'ff',
  );

  ipcMain.handle(AppChannels.setPullMode, (_event, mode: unknown): void => {
    if (!PULL_MODES.includes(mode as PullMode)) {
      throw new Error('Invalid pull mode');
    }
    settings.pullMode = mode as PullMode;
    saveSettings();
  });

  ipcMain.handle(
    AppChannels.getUpdateCheckInterval,
    (): UpdateCheckInterval =>
      settings.updateCheckInterval ?? DEFAULT_UPDATE_CHECK_INTERVAL,
  );

  ipcMain.handle(
    AppChannels.setUpdateCheckInterval,
    (_event, minutes: unknown): void => {
      if (!UPDATE_CHECK_INTERVALS.includes(minutes as UpdateCheckInterval)) {
        throw new Error('Invalid update check interval');
      }
      settings.updateCheckInterval = minutes as UpdateCheckInterval;
      saveSettings();
    },
  );

  ipcMain.on(AppChannels.openExternal, (_event, url: unknown): void => {
    if (typeof url !== 'string') return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    // Only ever hand https URLs on an allowed host to the OS browser: the
    // supported git providers, plus the project's Ko-fi (support) page.
    const allowed = providerForHost(parsed.hostname) || parsed.hostname === 'ko-fi.com';
    if (parsed.protocol === 'https:' && allowed) {
      void shell.openExternal(url);
    }
  });
}

// ---- Update check ---------------------------------------------------------

/** owner/repo whose GitHub Releases are the source of truth for updates. */
const GITHUB_RELEASES_REPO = 'johnyhalal/git-leviathan';

/** Parse a `major.minor.patch` string (tolerating a leading "v") into numbers. */
function parseSemver(raw: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whether `remote` is a strictly newer semver than `current`. */
function isNewerVersion(remote: string, current: string): boolean {
  const a = parseSemver(remote);
  const b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

// ---- In-app auto-update (macOS/Windows) ----------------------------------
//
// Electron's `autoUpdater` (Squirrel under the hood) downloads a newer signed
// build in the background and swaps + relaunches on `quitAndInstall()`. It only
// works on a packaged, code-signed build on macOS/Windows, so on any other
// build the renderer sees `supported: false` and falls back to opening the
// release page for a manual download. We point Squirrel at the free hosted
// update.electronjs.org feed, which reads this repo's GitHub Releases directly
// (it needs the per-arch `.zip` asset the release CI uploads alongside the
// installer). The feed URL carries the running version so it only ever returns
// something newer.

/** Whether this build can update itself in place (see UpdateStatus.supported). */
function autoUpdateSupported(): boolean {
  return (
    app.isPackaged &&
    (process.platform === 'darwin' || process.platform === 'win32')
  );
}

let updateStatus: UpdateStatus = { state: 'idle', supported: false };
let autoUpdaterWired = false;

function setUpdateStatus(next: UpdateStatus): void {
  updateStatus = next;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(UpdateChannels.statusChanged, next);
  }
}

/**
 * Broadcast the latest release-check result to every window so the status-bar
 * update control stays in sync no matter which window (or which trigger — the
 * periodic timer or the settings "Check now" button) ran the check.
 */
function broadcastUpdateFound(info: UpdateInfo | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(UpdateChannels.found, info);
  }
}

/**
 * Surface an auto-update line in the footer activity log, so the
 * download → available → ready flow can be debugged from inside the packaged
 * app — where there's no attached terminal. Uses the global activity path so it
 * shows regardless of which repo is open.
 */
function updateLog(text: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
  emitActivity({
    repoPath: GLOBAL_ACTIVITY_PATH,
    op: 'update',
    kind: 'line',
    stream,
    text,
    ts: Date.now(),
  });
}

/**
 * Point `autoUpdater` at the hosted feed and wire its events to `updateStatus`.
 * Safe to call once; a no-op (leaving `supported: false`) where auto-update
 * can't run, so `download()`/`install()` degrade to the manual fallback.
 */
function setupAutoUpdater(): void {
  if (autoUpdaterWired || !autoUpdateSupported()) return;
  const feedUrl =
    `https://update.electronjs.org/${GITHUB_RELEASES_REPO}` +
    `/${process.platform}-${process.arch}/${app.getVersion()}`;
  try {
    autoUpdater.setFeedURL({ url: feedUrl });
  } catch {
    // A malformed feed / unsupported platform: leave supported false.
    return;
  }
  updateLog(`feed URL: ${feedUrl}`);
  autoUpdater.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    updateLog(`error: ${message}`, 'stderr');
    setUpdateStatus({ state: 'error', supported: true, message });
  });
  autoUpdater.on('update-available', () => {
    updateLog('update-available — downloading…');
    setUpdateStatus({ state: 'downloading', supported: true, version: updateStatus.version });
  });
  autoUpdater.on('update-not-available', () => {
    // Only reachable after a manual download() with nothing newer to fetch.
    updateLog(
      'update-not-available — the Squirrel feed found nothing to download ' +
        '(check the release has a per-arch .zip asset for this platform/arch, and the build is signed)',
      'stderr',
    );
    setUpdateStatus({ state: 'idle', supported: true, version: updateStatus.version });
  });
  // Squirrel.Mac gives (event, notes, releaseName); releaseName is the version.
  autoUpdater.on('update-downloaded', (_event, _notes, releaseName?: string) => {
    updateLog(`update-downloaded: ${releaseName ?? '(unknown version)'} — ready to install`);
    setUpdateStatus({
      state: 'ready',
      supported: true,
      version: releaseName ?? updateStatus.version,
    });
  });
  autoUpdaterWired = true;
  updateStatus = { state: 'idle', supported: true };
}

function registerUpdateIpc(): void {
  setupAutoUpdater();

  ipcMain.on(UpdateChannels.download, (): void => {
    if (!autoUpdateSupported()) return;
    updateLog(`download requested — checking feed (target v${updateStatus.version ?? '?'})`);
    // Keep the version the check already surfaced so the UI can label progress.
    setUpdateStatus({ state: 'downloading', supported: true, version: updateStatus.version });
    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateLog(`checkForUpdates threw: ${message}`, 'stderr');
      setUpdateStatus({ state: 'error', supported: true, message });
    }
  });

  ipcMain.on(UpdateChannels.install, (): void => {
    if (updateStatus.state !== 'ready') return;
    // Swaps in the staged build and relaunches the app.
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle(UpdateChannels.status, (): UpdateStatus => updateStatus);

  ipcMain.handle(UpdateChannels.check, async (): Promise<UpdateInfo | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_RELEASES_REPO}/releases/latest`,
        {
          headers: {
            'User-Agent': 'GitLeviathan',
            Accept: 'application/vnd.github+json',
          },
          signal: controller.signal,
        },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
      };
      if (typeof data.tag_name !== 'string' || typeof data.html_url !== 'string') {
        return null;
      }
      if (!isNewerVersion(data.tag_name, app.getVersion())) {
        broadcastUpdateFound(null);
        return null;
      }
      const version = data.tag_name.replace(/^v/, '');
      // Remember it so a later download()'s progress can be labelled with the
      // target version before autoUpdater reports the downloaded release name.
      if (updateStatus.state === 'idle') updateStatus = { ...updateStatus, version };
      const info: UpdateInfo = { version, releaseUrl: data.html_url };
      broadcastUpdateFound(info);
      return info;
    } catch {
      // Offline, aborted, rate-limited, malformed — stay silent. Don't
      // broadcast: a failed check shouldn't clear a genuine pending update.
      return null;
    } finally {
      clearTimeout(timeout);
    }
  });

  ipcMain.on(UpdateChannels.openRelease, (_event, url: unknown): void => {
    if (typeof url !== 'string') return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    // Only ever hand github.com https URLs to the OS browser.
    if (parsed.protocol === 'https:' && parsed.hostname === 'github.com') {
      void shell.openExternal(url);
    }
  });
}

app.on('ready', () => {
  loadSettings();
  // Resolve the login-shell PATH in the background so git hooks (a pre-commit
  // Pest/PHPUnit run) can find php/node/etc. that a Finder-launched app misses.
  void initShellPath();
  reconcileIntegrations();
  loadGithubAvatars();
  applyDockIcon();
  nativeTheme.themeSource = settings.themeSource;
  registerThemeIpc();
  registerRepoIpc();
  registerIntegrationsIpc();
  registerClaudeIpc();
  registerAppIpc();
  registerUpdateIpc();
  boot();
});

// Closing the window quits the app on every platform. The usual macOS
// convention is to stay resident in the dock, but GitLeviathan treats the
// close button as "really close" so it doesn't linger after its last window.
app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    boot();
  }
});

// Don't leave git clone subprocesses running after the app starts to quit.
app.on('before-quit', () => {
  for (const running of runningClones.values()) {
    running.child.kill('SIGTERM');
  }
});
