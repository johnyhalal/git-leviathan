/**
 * Opening a repository or file in the user's own tools — their editor or a
 * terminal. Like `claude.ts`, this brings nothing of its own: it finds what's
 * installed (app bundles on macOS, known install paths on Windows, CLIs on the
 * login-shell PATH on Linux) and launches it. Nothing goes through a shell
 * string, so a file name can never be read as a command.
 *
 * The file manager ("Reveal in Finder") and the OS default app need Electron's
 * `shell`, so the main process handles those itself.
 */
import path from 'node:path';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { resolveOnPath } from './git';
import { isRunnable } from './claude';
import type { OpenResult, ToolOption } from './types/ipc';

interface ToolDef {
  id: string;
  name: string;
  /** macOS `.app` bundle names, looked up in the Applications folders. */
  mac?: string[];
  /** Windows: absolute `.exe` candidates (with `%VAR%`s), or bare names looked up on PATH. */
  win?: string[];
  /** Linux: CLI names looked up on PATH. */
  linux?: string[];
  /** Arguments for a non-macOS launch, given the target; defaults to `[target]`. */
  args?: (target: string) => string[];
}

const EDITORS: ToolDef[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    mac: ['Visual Studio Code'],
    win: [
      '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe',
      '%ProgramFiles%\\Microsoft VS Code\\Code.exe',
    ],
    linux: ['code'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    mac: ['Cursor'],
    win: ['%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe'],
    linux: ['cursor'],
  },
  {
    id: 'zed',
    name: 'Zed',
    mac: ['Zed'],
    win: ['%LOCALAPPDATA%\\Programs\\Zed\\Zed.exe'],
    linux: ['zed', 'zeditor'],
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    mac: ['Sublime Text'],
    win: ['%ProgramFiles%\\Sublime Text\\sublime_text.exe', '%ProgramFiles%\\Sublime Text 3\\sublime_text.exe'],
    linux: ['subl'],
  },
  { id: 'idea', name: 'IntelliJ IDEA', mac: ['IntelliJ IDEA', 'IntelliJ IDEA CE'], win: ['idea64'], linux: ['idea'] },
  { id: 'webstorm', name: 'WebStorm', mac: ['WebStorm'], win: ['webstorm64'], linux: ['webstorm'] },
  { id: 'phpstorm', name: 'PhpStorm', mac: ['PhpStorm'], win: ['phpstorm64'], linux: ['phpstorm'] },
  { id: 'xcode', name: 'Xcode', mac: ['Xcode'] },
];

const TERMINALS: ToolDef[] = [
  { id: 'terminal', name: 'Terminal', mac: ['Terminal'] },
  { id: 'iterm', name: 'iTerm', mac: ['iTerm'] },
  { id: 'warp', name: 'Warp', mac: ['Warp'] },
  { id: 'ghostty', name: 'Ghostty', mac: ['Ghostty'], linux: ['ghostty'], args: (dir) => [`--working-directory=${dir}`] },
  { id: 'wt', name: 'Windows Terminal', win: ['%LOCALAPPDATA%\\Microsoft\\WindowsApps\\wt.exe', 'wt'], args: (dir) => ['-d', dir] },
  { id: 'powershell', name: 'PowerShell', win: ['%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'], args: () => ['-NoExit'] },
  { id: 'cmd', name: 'Command Prompt', win: ['%SystemRoot%\\System32\\cmd.exe'], args: () => [] },
  { id: 'x-terminal-emulator', name: 'Default terminal', linux: ['x-terminal-emulator'], args: () => [] },
  { id: 'gnome-terminal', name: 'GNOME Terminal', linux: ['gnome-terminal'], args: (dir) => [`--working-directory=${dir}`] },
  { id: 'konsole', name: 'Konsole', linux: ['konsole'], args: (dir) => ['--workdir', dir] },
  { id: 'xfce4-terminal', name: 'Xfce Terminal', linux: ['xfce4-terminal'], args: (dir) => ['--working-directory', dir] },
  { id: 'kitty', name: 'kitty', linux: ['kitty'], args: (dir) => ['--directory', dir] },
  { id: 'alacritty', name: 'Alacritty', linux: ['alacritty'], args: (dir) => ['--working-directory', dir] },
];

const expandWinVars = (p: string) =>
  p.replace(/%([^%]+)%/g, (_m, name: string) => process.env[name] ?? '');

/** Where a tool is installed on this machine (an `.app` on macOS, an executable elsewhere), or null. */
function locate(tool: ToolDef): string | null {
  if (process.platform === 'darwin') {
    const dirs = ['/Applications', '/System/Applications/Utilities', path.join(homedir(), 'Applications')];
    for (const app of tool.mac ?? []) {
      for (const dir of dirs) {
        const bundle = path.join(dir, `${app}.app`);
        if (fs.existsSync(bundle)) return bundle;
      }
    }
    return null;
  }
  const candidates = process.platform === 'win32' ? tool.win : tool.linux;
  for (const candidate of candidates ?? []) {
    if (process.platform === 'win32' && candidate.includes('\\')) {
      const full = expandWinVars(candidate);
      // Store-app aliases (wt.exe) are reparse points `isRunnable` may not stat.
      if (isRunnable(full) || fs.existsSync(full)) return full;
    } else {
      const found = resolveOnPath(candidate);
      if (found) return found;
    }
  }
  return null;
}

let detected: { editors: Map<string, string>; terminals: Map<string, string> } | null = null;

/** Installed editors and terminals (id → location), probed once per session. */
function installed() {
  if (!detected) {
    const probe = (tools: ToolDef[]) => {
      const found = new Map<string, string>();
      for (const tool of tools) {
        const at = locate(tool);
        if (at) found.set(tool.id, at);
      }
      return found;
    };
    detected = { editors: probe(EDITORS), terminals: probe(TERMINALS) };
  }
  return detected;
}

const options = (tools: ToolDef[], found: Map<string, string>): ToolOption[] =>
  tools.filter((tool) => found.has(tool.id)).map(({ id, name }) => ({ id, name }));

export function detectEditors(): ToolOption[] {
  return options(EDITORS, installed().editors);
}

export function detectTerminals(): ToolOption[] {
  return options(TERMINALS, installed().terminals);
}

/** Start a GUI program detached from the app, resolving once it has spawned (or failed to). */
function launch(bin: string, args: string[], cwd: string): Promise<OpenResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn(bin, args, { cwd, detached: true, stdio: 'ignore' });
      child.once('error', (err) => resolve({ status: 'error', message: err.message }));
      child.once('spawn', () => {
        child.unref();
        resolve({ status: 'ok' });
      });
    } catch (err) {
      resolve({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
}

/** macOS: hand the target to an app bundle via `open -a`. */
function openWithApp(bundle: string, target: string): Promise<OpenResult> {
  return new Promise((resolve) => {
    execFile('open', ['-a', bundle, target], (err, _stdout, stderr) => {
      if (err) resolve({ status: 'error', message: stderr.trim() || err.message });
      else resolve({ status: 'ok' });
    });
  });
}

async function run(tool: ToolDef | undefined, at: string | undefined, target: string, cwd: string) {
  if (!tool || !at) return { status: 'error', message: 'That app is no longer installed.' } as OpenResult;
  if (process.platform === 'darwin') return openWithApp(at, target);
  return launch(at, tool.args ? tool.args(target) : [target], cwd);
}

/**
 * Open `target` (a repository folder or a file in it) in an installed editor,
 * or in the executable the user picked as their custom editor.
 */
export async function openInEditor(
  editorId: string,
  target: string,
  customPath?: string,
): Promise<OpenResult> {
  const cwd = fs.statSync(target).isDirectory() ? target : path.dirname(target);
  if (editorId === 'custom') {
    if (!customPath) return { status: 'error', message: 'Choose a custom editor in Settings.' };
    if (process.platform === 'darwin' && customPath.endsWith('.app')) return openWithApp(customPath, target);
    return launch(customPath, [target], cwd);
  }
  const tool = EDITORS.find((t) => t.id === editorId);
  return run(tool, installed().editors.get(editorId), target, cwd);
}

/** Open a terminal window whose working directory is `dir`. */
export async function openInTerminal(terminalId: string, dir: string): Promise<OpenResult> {
  const tool = TERMINALS.find((t) => t.id === terminalId);
  return run(tool, installed().terminals.get(terminalId), dir, dir);
}
