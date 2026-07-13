/**
 * Resolves which `git` binary the app runs and the environment it runs under.
 *
 * The app ships a self-contained git (from the `dugite` package's platform
 * build) so it works on machines with no git installed. We only borrow dugite's
 * path/environment helpers here — every git command is still executed by
 * main.ts's own `execFile`/`spawn`, so the streaming clone, scripted rebase,
 * etc. keep working unchanged.
 *
 * dugite normally locates its git relative to its own `__dirname`, but Vite
 * bundles the main process into `.vite/build/main.js`, which breaks that
 * assumption in *both* dev and packaged builds. So we point dugite at the git
 * dir explicitly via `LOCAL_GIT_DIRECTORY`:
 *   - packaged: `resources/git-<arch>` (the macOS universal build ships both
 *     `git-arm64` and `git-x64`, so each slice picks its own), falling back to
 *     `resources/git` for the single-arch platforms — both copied there by
 *     forge.config's `extraResource`.
 *   - dev:      the `git` folder inside the installed `dugite` package.
 * If no bundled binary is found, we fall back to the system `git` on PATH, so a
 * misconfigured bundle degrades instead of breaking the app.
 */
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveGitBinary, setupEnvironment } from 'dugite';

const execFileAsync = promisify(execFile);

// Ordered candidates; the first whose binary exists wins. `LOCAL_GIT_DIRECTORY`
// is left pointing at it so dugite's helpers resolve against the same dir.
const candidateGitDirs = app.isPackaged
  ? [
      path.join(process.resourcesPath, `git-${process.arch}`),
      path.join(process.resourcesPath, 'git'),
    ]
  : [path.join(app.getAppPath(), 'node_modules', 'dugite', 'git')];

/** Whether a bundled git was found; false means we use the system `git`. */
export const usingBundledGit = ((): boolean => {
  for (const dir of candidateGitDirs) {
    try {
      process.env.LOCAL_GIT_DIRECTORY = dir;
      if (fs.existsSync(resolveGitBinary())) return true;
    } catch {
      /* try the next candidate */
    }
  }
  delete process.env.LOCAL_GIT_DIRECTORY;
  return false;
})();

/** The git executable to invoke: the bundled binary, or `git` from PATH. */
export const gitBin = usingBundledGit ? resolveGitBinary() : 'git';

/**
 * Well-known bin dirs a GUI app launched from Finder/Dock never inherits, where
 * tools a git hook may call (php, node, composer) commonly live. Prepended to
 * PATH as a fallback even when the login-shell lookup below fails.
 */
function wellKnownBinDirs(): string[] {
  if (process.platform === 'win32') return [];
  const home = homedir();
  return [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    // Laravel Herd ships its own php — a very common setup for Pest/PHPUnit hooks.
    path.join(home, 'Library', 'Application Support', 'Herd', 'bin'),
  ].filter((dir) => fs.existsSync(dir));
}

/** The user's real login-shell PATH, resolved once by `initShellPath` and cached. */
let loginShellPath: string | null = null;

/**
 * Resolve the login shell's PATH so git hooks spawned by a Finder/Dock-launched
 * app can find tools (php, node, composer, version-manager shims) that live on a
 * PATH a GUI process never inherits on macOS — the same reason claude.ts and the
 * git-binary lookup ask a login shell. Best-effort and cached; call once at boot.
 */
export async function initShellPath(): Promise<void> {
  if (process.platform === 'win32') return;
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    // `-lic` loads login+interactive rc files so PATH matches a real terminal.
    const { stdout } = await execFileAsync(shell, ['-lic', 'printf %s "$PATH"'], {
      timeout: 8_000,
    });
    // Take the last non-empty line so any rc-file banner output is ignored.
    const line = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.includes(path.delimiter) || s.startsWith('/'))
      .pop();
    if (line) loginShellPath = line;
  } catch {
    /* keep the process PATH; wellKnownBinDirs still covers the common cases */
  }
}

/** Merge the well-known dirs and login-shell PATH ahead of `base`, de-duped. */
function augmentedPath(base: string | undefined): string {
  const sep = path.delimiter;
  const parts = [
    ...wellKnownBinDirs(),
    ...(loginShellPath ? loginShellPath.split(sep) : []),
    ...(base ?? process.env.PATH ?? '').split(sep),
  ].filter(Boolean);
  return Array.from(new Set(parts)).join(sep);
}

/**
 * The environment a git child should run under. For the bundled git this adds
 * the vars it needs to find its own subcommands/templates/config (GIT_EXEC_PATH,
 * GIT_TEMPLATE_DIR, …); for the system git it's just the process env. Pass any
 * per-call overrides (e.g. `GIT_TERMINAL_PROMPT`) as `extra`.
 *
 * On macOS/Linux the child's PATH is widened (see `augmentedPath`) so a hook can
 * find tools the GUI's own PATH lacks; Windows GUIs inherit PATH, so it's left be.
 */
export function gitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const base = usingBundledGit ? setupEnvironment(extra).env : { ...process.env, ...extra };
  if (process.platform === 'win32') return base;
  return { ...base, PATH: augmentedPath(base.PATH) };
}
