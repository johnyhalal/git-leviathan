import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { ThemeChannels, type ThemeSource, type ThemeState } from './types/ipc';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

/** Minimum time the splash stays visible so it never just flashes. */
const MIN_SPLASH_MS = 1800;
const THEME_SOURCES: ThemeSource[] = ['system', 'light', 'dark'];
const preloadPath = path.join(__dirname, 'preload.js');

// ---- Tiny settings persistence -------------------------------------------

interface Settings {
  themeSource: ThemeSource;
}

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings(): Settings {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(settingsPath(), 'utf-8'),
    ) as Partial<Settings>;
    if (parsed.themeSource && THEME_SOURCES.includes(parsed.themeSource)) {
      return { themeSource: parsed.themeSource };
    }
  } catch {
    // No settings file yet or it is unreadable — fall back to defaults.
  }
  return { themeSource: 'system' };
}

function writeSettings(settings: Settings): void {
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
    writeSettings({ themeSource: source });
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

// ---- Windows --------------------------------------------------------------

function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 200,
    height: 300,
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
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e24' : '#f5f5f7',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: preloadPath },
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

/** Show the splash, load the main window behind it, then hand off. */
function boot(): void {
  const splash = createSplashWindow();
  const shownAt = Date.now();
  const mainWindow = createMainWindow();

  mainWindow.once('ready-to-show', () => {
    const remaining = Math.max(0, MIN_SPLASH_MS - (Date.now() - shownAt));
    setTimeout(() => {
      if (!splash.isDestroyed()) {
        splash.close();
      }
      mainWindow.show();
      mainWindow.focus();
    }, remaining);
  });
}

app.on('ready', () => {
  nativeTheme.themeSource = readSettings().themeSource;
  registerThemeIpc();
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
