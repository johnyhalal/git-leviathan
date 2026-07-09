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
import { resolveGitBinary, setupEnvironment } from 'dugite';

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
 * The environment a git child should run under. For the bundled git this adds
 * the vars it needs to find its own subcommands/templates/config (GIT_EXEC_PATH,
 * GIT_TEMPLATE_DIR, …); for the system git it's just the process env. Pass any
 * per-call overrides (e.g. `GIT_TERMINAL_PROMPT`) as `extra`.
 */
export function gitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  if (usingBundledGit) return setupEnvironment(extra).env;
  return { ...process.env, ...extra };
}
