import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  screen,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import {
  AppChannels,
  RepoChannels,
  ThemeChannels,
  type OpenRepoResult,
  type ThemeSource,
  type ThemeState,
} from './types/ipc';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

/** Minimum time the splash stays visible so it never just flashes. */
const MIN_SPLASH_MS = 2000;
const THEME_SOURCES: ThemeSource[] = ['system', 'light', 'dark'];
const preloadPath = path.join(__dirname, 'preload.js');

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
}

const DEFAULT_WINDOW = { width: 1100, height: 720 } as const;

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
}

// ---- Dock icon ------------------------------------------------------------

/**
 * Show the app icon in the macOS dock during development. Packaged builds get
 * their icon from `packagerConfig.icon`, so this is only needed under
 * `electron-forge start`, where the source lives at `assets/icon.png`.
 * (Currently a white placeholder — replace with a PNG rendered from
 * `assets/icon.svg`.)
 */
function applyDockIcon(): void {
  if (process.platform !== 'darwin' || app.isPackaged || !app.dock) return;
  const icon = nativeImage.createFromPath(
    path.join(process.cwd(), 'assets', 'icon.png'),
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
  applyDockIcon();
  nativeTheme.themeSource = settings.themeSource;
  registerThemeIpc();
  registerRepoIpc();
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
