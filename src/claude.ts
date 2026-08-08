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
const GENERATE_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 8_000;
/** Cap the diff we hand to the model so a huge changeset can't blow up the call. */
const MAX_DIFF_CHARS = 100_000;

/**
 * Files whose *diff content* is withheld from the commit-message model. The
 * filenames are still listed for the model (so it knows they changed) — only
 * their patch hunks are dropped, keeping lockfiles/generated/binary noise out of
 * the prompt. This is a code-level config, gitignore syntax, deliberately NOT
 * user-editable: tune it by editing this list. Later patterns override earlier
 * ones, and a leading `!` re-includes (same precedence rules as .gitignore).
 */
export const COMMIT_CONTEXT_EXCLUDES: readonly string[] = [
  // Lockfiles — large, noisy, rarely inform the message.
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'composer.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  '*.lock',
  // Generated / minified / source maps.
  '*.min.js',
  '*.min.css',
  '*.map',
  // Build output and vendored dependencies.
  'dist/',
  'build/',
  'out/',
  'vendor/',
  'node_modules/',
  // Binary-ish assets — no meaningful textual diff.
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.webp',
  '*.ico',
  '*.svg',
  '*.pdf',
  '*.woff',
  '*.woff2',
  '*.ttf',
  '*.eot',
  '*.zip',
  '*.gz',
  // Certificates / keystores — opaque credential blobs, never informative in a diff.
  '*.pem',
  '*.crt',
  '*.cer',
  '*.der',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.p7b',
  '*.p7c',
  '*.jks',
  '*.keystore',
  '*.truststore',
];

/** A gitignore pattern compiled to a matcher against a repo-relative path. */
interface CompiledExclude {
  re: RegExp;
  /** A `!`-prefixed pattern re-includes a path an earlier pattern excluded. */
  negated: boolean;
}

/** Translate a single gitignore-style pattern into a regex, or null to skip it. */
function compileGitignore(pattern: string): CompiledExclude | null {
  let pat = pattern.trim();
  if (!pat || pat.startsWith('#')) return null;

  let negated = false;
  if (pat.startsWith('!')) {
    negated = true;
    pat = pat.slice(1);
  }

  // A trailing slash restricts the match to directories (i.e. the path must
  // continue past the name); strip it and remember.
  let dirOnly = false;
  if (pat.endsWith('/')) {
    dirOnly = true;
    pat = pat.slice(0, -1);
  }

  // A leading slash, or any interior slash, anchors the pattern to the repo
  // root; a bare name (no slash) matches at any depth.
  let anchored = false;
  if (pat.startsWith('/')) {
    anchored = true;
    pat = pat.slice(1);
  } else if (pat.includes('/')) {
    anchored = true;
  }

  let body = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*') {
      if (pat[i + 1] === '*') {
        i++;
        if (pat[i + 1] === '/') {
          i++;
          body += '(?:.*/)?'; // `**/` — zero or more leading directories
        } else {
          body += '.*'; // `**` — anything, crossing directory separators
        }
      } else {
        body += '[^/]*'; // `*` — anything within a single path segment
      }
    } else if (c === '?') {
      body += '[^/]';
    } else {
      body += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }

  const prefix = anchored ? '^' : '(?:^|/)';
  // A directory pattern must be followed by a separator; a name pattern may end
  // the path or be a directory prefix of it.
  const suffix = dirOnly ? '/' : '(?:/|$)';
  return { re: new RegExp(prefix + body + suffix), negated };
}

const COMPILED_EXCLUDES: CompiledExclude[] = COMMIT_CONTEXT_EXCLUDES.map(
  compileGitignore,
).filter((c): c is CompiledExclude => c !== null);

/**
 * Whether a staged file's *content* should be withheld from the model. Evaluates
 * all patterns in order so a later `!` negation can re-include an earlier match,
 * mirroring .gitignore precedence. Backslashes are normalized so Windows paths
 * match the same forward-slash patterns.
 */
export function isCommitContextExcluded(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  let excluded = false;
  for (const { re, negated } of COMPILED_EXCLUDES) {
    if (re.test(p)) excluded = !negated;
  }
  return excluded;
}

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
  'Output ONLY the commit message — no preamble, no markdown, no code fences, no backticks, no leading text.',
  'Follow the Conventional Commits 1.0.0 specification:',
  'The first line MUST be "<type>[optional scope][optional !]: <description>".',
  'The type is a lowercase noun such as feat (a new feature), fix (a bug fix), docs, style, refactor, perf, test, build, ci, chore, or revert.',
  'An optional scope in parentheses may follow the type to give extra context, e.g. "feat(parser): ...".',
  'After the type/scope comes a colon, a single space, then a short imperative description; keep the whole first line under 72 characters with no trailing period.',
  'If the change is non-trivial, add a blank line then a body (wrapped ~72 cols) explaining what changed and why, in one or more paragraphs.',
  'For breaking changes, either append "!" before the colon (e.g. "feat!:") and/or add a footer starting with "BREAKING CHANGE: " describing the break.',
  'Other footers use the "Token: value" form (e.g. "Refs: #123", "Reviewed-by: name"), one per line after a blank line.',
  'Prefer a type/scope consistent with the recent commit subjects listed on stdin when they already follow this convention.',
  'The stdin lists every changed file; some are marked "(diff omitted)" (e.g. lockfiles, generated or binary files) and their patch is intentionally not shown — still account for them in the message when relevant, but base the wording on the files whose diff you can see.',
  'Make the commit description short and compact as possible or if it is just contain not major changes then you can leave it.',
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

/** Token-usage counters reported by `claude -p --output-format json`. */
interface ClaudeUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

/** The subset of the `--output-format json` envelope we read. */
interface ClaudeJsonResult {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: ClaudeUsage;
}

/** Normalized token usage/cost parsed from a single generation. */
export interface CommitUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd?: number;
}

/** The generated commit message plus, when available, its token usage. */
export interface CommitMessageResult {
  message: string;
  usage?: CommitUsage;
}

/** The Conventional Commits types we anchor the header on when de-preambling. */
const COMMIT_TYPES =
  'feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert';
/** A valid first line: "<type>[optional (scope)][optional !]: <description>". */
const COMMIT_HEADER_RE = new RegExp(
  `^(?:${COMMIT_TYPES})(?:\\([^)]+\\))?!?: .+`,
);

/**
 * Strip any conversational preamble the model prepends despite instructions
 * (e.g. "Here is the commit message:" or "The commit message:"). Because a valid
 * message MUST start with a Conventional Commits header, we drop everything up to
 * the first line that matches one. If no such line exists we return the message
 * unchanged rather than risk throwing away a legitimately-formatted message.
 */
function stripCommitPreamble(message: string): string {
  const lines = message.split(/\r?\n/);
  const start = lines.findIndex((line) => COMMIT_HEADER_RE.test(line.trim()));
  if (start <= 0) return message.trim();
  return lines.slice(start).join('\n').trim();
}

/**
 * Parse the `--output-format json` envelope into the message plus its token
 * usage. Falls back to treating the raw stdout as the message (with no usage)
 * if the payload isn't the JSON we expect, so a format change degrades
 * gracefully rather than breaking generation.
 */
function parseCommitResult(stdout: string): CommitMessageResult {
  const trimmed = stdout.trim();
  let parsed: ClaudeJsonResult | null = null;
  try {
    parsed = JSON.parse(trimmed) as ClaudeJsonResult;
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed.result !== 'string') {
    return { message: stripCommitPreamble(trimmed) };
  }

  const u = parsed.usage ?? {};
  return {
    message: stripCommitPreamble(parsed.result.trim()),
    usage: {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      costUsd:
        typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : undefined,
    },
  };
}

/**
 * Generate a commit message from the staged diff by piping it to `claude -p`.
 * `recentSubjects` are woven into stdin (never argv) so a crafted commit subject
 * can't influence the command line. `changedFiles` is the full staged file list
 * — always shown so the model sees every change — while `excludedFiles` (a
 * subset) are the ones whose patch content was withheld (see
 * `COMMIT_CONTEXT_EXCLUDES`); they're listed but flagged, and `diff` already
 * omits their hunks. Rejects with a distilled error on failure.
 */
export function generateCommitMessage(
  bin: string,
  diff: string,
  changedFiles: string[],
  excludedFiles: string[],
  recentSubjects: string[],
  cwd: string,
): Promise<CommitMessageResult> {
  const trimmedDiff =
    diff.length > MAX_DIFF_CHARS
      ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated for length]`
      : diff;
  const excludedSet = new Set(excludedFiles);
  const filesSection = changedFiles.length
    ? `Changed files (staged):\n${changedFiles
        .map((f) => (excludedSet.has(f) ? `- ${f} (diff omitted)` : `- ${f}`))
        .join('\n')}\n\n`
    : '';
  const stdin =
    (recentSubjects.length
      ? `Recent commit subjects in this repository (match their style):\n${recentSubjects
          .map((s) => `- ${s}`)
          .join('\n')}\n\n`
      : '') +
    filesSection +
    `Staged diff:\n${trimmedDiff}\n`;

  return new Promise((resolve, reject) => {
    // `--output-format json` wraps the message in an envelope that also carries
    // token usage and cost, which we log; we still resolve with the plain text.
    const child = spawnClaude(
      bin,
      ['-p', COMMIT_INSTRUCTION, '--model', 'sonnet', '--output-format', 'json'],
      cwd,
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      // SIGKILL (not the default SIGTERM) so a wedged `claude` can't ignore the
      // signal and keep the button spinning past the timeout.
      child.kill('SIGKILL');
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
        resolve(parseCommitResult(out));
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
