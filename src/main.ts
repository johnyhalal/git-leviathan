import {
  app,
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
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import started from 'electron-squirrel-startup';
import {
  AppChannels,
  IntegrationChannels,
  RepoChannels,
  ThemeChannels,
  type CloneProgress,
  type CloneRequest,
  type CloneResult,
  type DeviceCodePrompt,
  type IntegrationConnection,
  type IntegrationProvider,
  type IntegrationsState,
  type OpenRepoResult,
  type RecentRepo,
  type RemoteRepo,
  type RepoInfo,
  type ThemeSource,
  type ThemeState,
} from './types/ipc';
import type { DeviceAuthorization } from './oauth/deviceFlow';
import * as github from './oauth/github';
import * as gitlab from './oauth/gitlab';

// Name the app before anything reads it, so app.getName(), the userData path,
// notifications and the About panel all say "GitLeviathan" rather than
// Electron's default. (In dev the dock/menu label additionally comes from the
// Electron.app bundle's Info.plist — see scripts/rename-dev-app.mjs.)
app.setName('GitLeviathan');

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
  /** Scopes to request — enough to list and clone repos and read the handle. */
  scope: string;
  requestDeviceAuthorization: typeof github.requestDeviceAuthorization;
  pollForAccessToken: typeof github.pollForAccessToken;
  fetchUserLogin: typeof github.fetchUserLogin;
  fetchUserRepos: typeof github.fetchUserRepos;
}

// One entry per provider; the connect/list handlers are otherwise generic.
const PROVIDER_CLIENTS: Record<IntegrationProvider, ProviderClient> = {
  github: {
    clientId: GITHUB_CLIENT_ID,
    scope: 'repo read:user',
    requestDeviceAuthorization: github.requestDeviceAuthorization,
    pollForAccessToken: github.pollForAccessToken,
    fetchUserLogin: github.fetchUserLogin,
    fetchUserRepos: github.fetchUserRepos,
  },
  gitlab: {
    clientId: GITLAB_CLIENT_ID,
    scope: 'read_api read_repository',
    requestDeviceAuthorization: gitlab.requestDeviceAuthorization,
    pollForAccessToken: gitlab.pollForAccessToken,
    fetchUserLogin: gitlab.fetchUserLogin,
    fetchUserRepos: gitlab.fetchUserRepos,
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
  /** Connected Git host accounts, keyed by provider id. */
  integrations?: Partial<Record<IntegrationProvider, IntegrationConnection>>;
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
    typeof r.lastOpenedAt === 'number'
  );
}

function isIntegrationProvider(value: unknown): value is IntegrationProvider {
  return (
    typeof value === 'string' &&
    (INTEGRATION_PROVIDERS as string[]).includes(value)
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
    (c.account === undefined || typeof c.account === 'string')
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

interface RunningClone {
  child: ChildProcess;
  /** Folder git is cloning into, removed if the clone is canceled. */
  target: string;
  canceled: boolean;
}

// In-flight clones keyed by the requesting window's webContents id. The clone
// UI is modal, so at most one runs per window — cancel targets that one.
const runningClones = new Map<number, RunningClone>();

function registerRepoIpc(): void {
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
      const entry: RecentRepo = {
        name: repo.name,
        path: repo.path,
        lastOpenedAt: Date.now(),
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
      const sender = event.sender;

      return new Promise<CloneResult>((resolve) => {
        // Array args (no shell) avoid injection; `--` stops the URL/target from
        // being read as options; the protocol allow-list blocks git's local
        // command-exec transports (ext::/fd::). GIT_TERMINAL_PROMPT=0 makes an
        // unauthorized clone fail fast instead of hanging on a prompt.
        const child = spawn(
          'git',
          ['clone', '--progress', '--', cloneUrl, target],
          {
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0',
              GIT_ALLOW_PROTOCOL: 'https:http:git:ssh:file',
            },
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
    return { provider, status: 'connected', account: persisted.account };
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
    const account = await client.fetchUserLogin(token, controller.signal);
    storeToken(provider, token);
    settings.integrations = {
      ...settings.integrations,
      [provider]: { provider, status: 'connected', account },
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
    splash.loadURL(SPLASH_WINDOW_VITE_DEV_SERVER_URL);
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
    webPreferences: { preload: preloadPath },
  });

  if (settings.windowMaximized) {
    win.maximize();
  }

  // Persist size/position (and maximized state) as they were on close.
  // getNormalBounds() returns the un-maximized bounds so a restore lands right.
  win.on('close', () => {
    settings.windowBounds = win.getNormalBounds();
    settings.windowMaximized = win.isMaximized();
    saveSettings();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
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
  setTimeout(reveal, REVEAL_FALLBACK_MS);
}

app.on('ready', () => {
  loadSettings();
  reconcileIntegrations();
  applyDockIcon();
  nativeTheme.themeSource = settings.themeSource;
  registerThemeIpc();
  registerRepoIpc();
  registerIntegrationsIpc();
  console.log(
    `[main] ready — theme "${nativeTheme.themeSource}" (dark=${nativeTheme.shouldUseDarkColors})`,
  );
  boot();
});

// On macOS it is common for applications to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
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
