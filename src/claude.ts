/**
 * Bridges GitLeviathan to a *locally installed* Claude Code CLI (`claude`).
 *
 * Deliberately no third-party service and no credentials in this app: we shell
 * out to the user's own `claude` binary, which already carries their auth (a
 * Claude subscription login or their own API key). We only ever run it in
 * headless "print" mode (`claude -p`), feeding it the staged diff on stdin and
 * reading back a commit message on stdout.
 *
 * A GUI app on macOS doesn't inherit the shell's PATH, so a bare `claude` call
 * usually fails even when it's installed. `resolveClaudeBin` therefore mirrors
 * the spirit of git.ts: try an explicit user override, then well-known install
 * locations, then ask a login shell where `claude` lives.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const execFileAsync = promisify(execFile);

/** How long a single `claude` invocation may run before we give up (ms). */
const GENERATE_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 8_000;
/** Cap the diff we hand to the model so a huge changeset can't blow up the call. */
const MAX_DIFF_CHARS = 100_000;

/** Well-known absolute install locations, checked before a login-shell lookup. */
function candidatePaths(): string[] {
  const home = homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    return [
      ...(appData ? [path.join(appData, 'npm', 'claude.cmd')] : []),
      path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
    ];
  }
  return [
    path.join(home, '.claude', 'local', 'claude'),
    path.join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ];
}

/** Whether `p` is an existing, executable file. */
export function isRunnable(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    // On Windows there's no X_OK bit worth checking; existence is enough.
    if (process.platform === 'win32') return true;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the user's login shell where `claude` resolves. This picks up PATHs from
 * nvm/fnm/asdf/Homebrew that an Electron GUI process never inherits on macOS.
 * Returns an absolute path or null.
 */
async function shellResolve(): Promise<string | null> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('where', ['claude'], {
        timeout: PROBE_TIMEOUT_MS,
      });
      const first = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);
      return first ?? null;
    } catch {
      return null;
    }
  }
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    // `-lic` loads the login+interactive rc files so PATH matches a real terminal.
    const { stdout } = await execFileAsync(shell, ['-lic', 'command -v claude'], {
      timeout: PROBE_TIMEOUT_MS,
    });
    const line = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .pop();
    return line && path.isAbsolute(line) ? line : null;
  } catch {
    return null;
  }
}

/**
 * Locate a runnable `claude` binary. Prefers an explicit `override` (the path a
 * user picked in Settings), then known locations, then a login-shell lookup.
 */
export async function resolveClaudeBin(
  override?: string | null,
): Promise<string | null> {
  if (override && isRunnable(override)) return override;
  for (const candidate of candidatePaths()) {
    if (isRunnable(candidate)) return candidate;
  }
  return shellResolve();
}

/** What we can tell about the local Claude Code install without signing in. */
export interface ClaudeProbe {
  installed: boolean;
  binaryPath?: string;
  version?: string;
}

/** Resolve the binary and read its version; `installed:false` when not found. */
export async function probeClaude(
  override?: string | null,
): Promise<ClaudeProbe> {
  const bin = await resolveClaudeBin(override);
  if (!bin) return { installed: false };
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], {
      timeout: PROBE_TIMEOUT_MS,
    });
    const version = stdout.trim();
    return { installed: true, binaryPath: bin, version: version || undefined };
  } catch {
    // Found the binary but couldn't read a version — still treat it as present.
    return { installed: true, binaryPath: bin };
  }
}

/** The static instruction handed to `claude -p`; repo-specific context is on stdin. */
const COMMIT_INSTRUCTION = [
  'You are writing a git commit message for the staged changes provided on stdin.',
  'Output ONLY the commit message — no preamble, no markdown, no code fences, no backticks.',
  'Follow the Conventional Commits 1.0.0 specification:',
  'The first line MUST be "<type>[optional scope][optional !]: <description>".',
  'The type is a lowercase noun such as feat (a new feature), fix (a bug fix), docs, style, refactor, perf, test, build, ci, chore, or revert.',
  'An optional scope in parentheses may follow the type to give extra context, e.g. "feat(parser): ...".',
  'After the type/scope comes a colon, a single space, then a short imperative description; keep the whole first line under 72 characters with no trailing period.',
  'If the change is non-trivial, add a blank line then a body (wrapped ~72 cols) explaining what changed and why, in one or more paragraphs.',
  'For breaking changes, either append "!" before the colon (e.g. "feat!:") and/or add a footer starting with "BREAKING CHANGE: " describing the break.',
  'Other footers use the "Token: value" form (e.g. "Refs: #123", "Reviewed-by: name"), one per line after a blank line.',
  'Prefer a type/scope consistent with the recent commit subjects listed on stdin when they already follow this convention.',
].join(' ');

/**
 * Spawn `claude` in a cross-platform-safe way. On Windows the resolved binary is
 * usually a `.cmd` shim, which must be run through the command interpreter; Node
 * still escapes each array arg, so no shell string-splicing is involved.
 */
function spawnClaude(bin: string, args: string[], cwd: string) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    const comspec = process.env.COMSPEC || 'cmd.exe';
    return spawn(comspec, ['/c', bin, ...args], { cwd });
  }
  return spawn(bin, args, { cwd });
}

/**
 * Generate a commit message from the staged diff by piping it to `claude -p`.
 * `recentSubjects` are woven into stdin (never argv) so a crafted commit subject
 * can't influence the command line. Rejects with a distilled error on failure.
 */
export function generateCommitMessage(
  bin: string,
  diff: string,
  recentSubjects: string[],
  cwd: string,
): Promise<string> {
  const trimmedDiff =
    diff.length > MAX_DIFF_CHARS
      ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated for length]`
      : diff;
  const stdin =
    (recentSubjects.length
      ? `Recent commit subjects in this repository (match their style):\n${recentSubjects
          .map((s) => `- ${s}`)
          .join('\n')}\n\n`
      : '') + `Staged diff:\n${trimmedDiff}\n`;

  return new Promise((resolve, reject) => {
    const child = spawnClaude(
      bin,
      ['-p', COMMIT_INSTRUCTION, '--output-format', 'text'],
      cwd,
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude timed out generating the message.'));
    }, GENERATE_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(out.trim());
      } else {
        const detail = err.trim() || out.trim();
        reject(new Error(detail || `Claude exited with code ${code}.`));
      }
    });

    child.stdin.on('error', () => {
      /* the child may exit before we finish writing; the close handler reports it */
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

/** Distill a thrown error from a `claude` run to one user-facing line. */
export function claudeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const line =
    raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .pop() ?? '';
  const message = line || 'Claude could not generate a message.';
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}
