/**
 * External diff/merge tools — Beyond Compare, Kaleidoscope, VS Code, Meld… —
 * launched through git's own `difftool` / `mergetool`. Git already knows how
 * to drive two dozen tools (their arguments, temp files for the non-worktree
 * side, `$MERGED` for a conflict) and honours whatever the user configured in
 * `.gitconfig`, so this module only decides *which* tool and helps git find it:
 *
 * - the tools git reports as available (`--tool-help`), minus the terminal-only
 *   ones (vimdiff, emerge…) that would hang with no TTY;
 * - tools git supports but can't see because a Finder-launched app has no shell
 *   PATH — found in their app bundles / install dirs and handed to git as
 *   `-c <kind>tool.<id>.path=…`;
 * - Kaleidoscope, which git doesn't know, via a `-c <kind>tool.<id>.cmd=…`.
 *
 * Electron-free; the main process owns the setting and the IPC.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { gitBin, gitEnv, resolveOnPath } from './git';
import { isRunnable } from './claude';
import type { ExternalMergeStatus, ExternalToolKind, OpenResult, ToolOption } from './types/ipc';

/** A usable tool: what to show, and the `-c` config git needs to run it. */
interface DetectedTool extends ToolOption {
  /** `key=value` pairs passed to git as `-c` before the subcommand. */
  config: string[];
}

/** Where a tool git supports lives when it isn't on PATH. */
interface KnownLocation {
  id: string;
  name: string;
  mac?: string[];
  win?: string[];
}

const KNOWN_LOCATIONS: KnownLocation[] = [
  {
    id: 'araxis',
    name: 'Araxis Merge',
    mac: ['/Applications/Araxis Merge.app/Contents/Utilities/compare'],
    win: ['%ProgramFiles%\\Araxis\\Araxis Merge\\Compare.exe'],
  },
  {
    id: 'bc',
    name: 'Beyond Compare',
    mac: ['/Applications/Beyond Compare.app/Contents/MacOS/bcomp'],
    win: ['%ProgramFiles%\\Beyond Compare 5\\BComp.exe', '%ProgramFiles%\\Beyond Compare 4\\BComp.exe'],
  },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    mac: ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
    win: [
      '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\bin\\code.cmd',
      '%ProgramFiles%\\Microsoft VS Code\\bin\\code.cmd',
    ],
  },
  {
    id: 'smerge',
    name: 'Sublime Merge',
    mac: ['/Applications/Sublime Merge.app/Contents/SharedSupport/bin/smerge'],
    win: ['%ProgramFiles%\\Sublime Merge\\smerge.exe'],
  },
  {
    id: 'p4merge',
    name: 'HelixCore P4Merge',
    mac: ['/Applications/p4merge.app/Contents/Resources/launchp4merge'],
    win: ['%ProgramFiles%\\Perforce\\p4merge.exe'],
  },
  {
    id: 'meld',
    name: 'Meld',
    mac: ['/Applications/Meld.app/Contents/MacOS/Meld'],
    win: ['%ProgramFiles%\\Meld\\Meld.exe', '%LOCALAPPDATA%\\Programs\\Meld\\Meld.exe'],
  },
  {
    id: 'kdiff3',
    name: 'KDiff3',
    mac: ['/Applications/kdiff3.app/Contents/MacOS/kdiff3'],
    win: ['%ProgramFiles%\\KDiff3\\kdiff3.exe', '%ProgramFiles%\\KDiff3\\bin\\kdiff3.exe'],
  },
  { id: 'winmerge', name: 'WinMerge', win: ['%ProgramFiles%\\WinMerge\\WinMergeU.exe'] },
  { id: 'tortoisemerge', name: 'TortoiseMerge', win: ['%ProgramFiles%\\TortoiseSVN\\bin\\TortoiseMerge.exe'] },
];

/** Kaleidoscope's `ksdiff`: on PATH once its command-line tool is installed, else in the bundle. */
const KALEIDOSCOPE_BUNDLE = [
  '/Applications/Kaleidoscope.app/Contents/Resources/bin/ksdiff',
  '/Applications/Kaleidoscope.app/Contents/MacOS/ksdiff',
];

/** Git tools that run in a terminal — with no TTY they'd hang, so they're never offered. */
const TERMINAL_ONLY = /^(vimdiff|nvimdiff|emerge)\d*$/;

/**
 * Tools git reports from a bare PATH name that's often something else: araxis
 * is just `compare`, which is usually ImageMagick's. Only trusted when found at
 * their install location (KNOWN_LOCATIONS).
 */
const AMBIGUOUS_ON_PATH = new Set(['araxis']);

/** FileMerge's `/usr/bin/opendiff` is a stub on every Mac; it only works with Xcode installed. */
const hasXcode = () => process.platform === 'darwin' && isRunnable('/Applications/Xcode.app/Contents/MacOS/Xcode');

const expandWinVars = (p: string) =>
  p.replace(/%([^%]+)%/g, (_m, name: string) => process.env[name] ?? '');

function firstExisting(candidates: string[] | undefined): string | null {
  for (const candidate of candidates ?? []) {
    const full = process.platform === 'win32' ? expandWinVars(candidate) : candidate.replace(/^~/, homedir());
    if (isRunnable(full)) return full;
  }
  return null;
}

/** Quote a value for the POSIX `sh` git runs a tool's `cmd` under. */
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** `git <kind>tool --tool-help`, run where repo-local tool config is visible. */
function toolHelp(kind: ExternalToolKind, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      gitBin,
      [`${kind}tool`, '--tool-help'],
      { cwd, env: gitEnv({ GIT_TERMINAL_PROMPT: '0' }), timeout: 10_000 },
      // `--tool-help` exits non-zero on some versions even though it printed the list.
      (_err, stdout) => resolve(typeof stdout === 'string' ? stdout : ''),
    );
  });
}

/**
 * The tools `--tool-help` lists as available: built-ins git found on PATH
 * (display name from their "Use …" description) and user-defined ones.
 */
function parseToolHelp(out: string): ToolOption[] {
  const found: ToolOption[] = [];
  let userDefined = false;
  for (const line of out.split('\n')) {
    // Everything after this header is unavailable.
    if (/not currently available/.test(line)) break;
    if (/^\s*user-defined:/.test(line)) {
      userDefined = true;
      continue;
    }
    const match = /^\t\t(\S+)\s*(.*)$/.exec(line);
    if (!match) continue;
    if (userDefined) {
      // "name.cmd <the command>"
      const id = match[1].replace(/\.cmd$/, '');
      if (id) found.push({ id, name: id });
      continue;
    }
    const [, id, desc] = match;
    if (TERMINAL_ONLY.test(id) || !/graphical session/.test(desc)) continue;
    const name = desc
      .replace(/^Use\s+/, '')
      .replace(/\s*\(requires a graphical session\)/, '')
      .replace(/\s+with\s.*$/, '')
      .trim();
    found.push({ id, name: name || id });
  }
  return found;
}

const cache = new Map<ExternalToolKind, DetectedTool[]>();

/**
 * The GUI tools usable for `kind` on this machine, de-duplicated by name (git
 * lists `bc`, `bc3` and `bc4` for the same Beyond Compare). Probed once per
 * session unless `refresh` asks for a fresh look (Settings does).
 */
export async function detectExternalTools(
  kind: ExternalToolKind,
  refresh = false,
): Promise<DetectedTool[]> {
  const cached = cache.get(kind);
  if (cached && !refresh) return cached;

  const tools: DetectedTool[] = [];
  const add = (tool: DetectedTool) => {
    if (tools.some((t) => t.id === tool.id || t.name === tool.name)) return;
    tools.push(tool);
  };

  for (const tool of parseToolHelp(await toolHelp(kind, homedir()))) {
    if (AMBIGUOUS_ON_PATH.has(tool.id)) continue;
    if (tool.id === 'opendiff' && process.platform === 'darwin' && !hasXcode()) continue;
    add({ ...tool, config: [] });
  }

  const platformKey = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : null;
  if (platformKey) {
    for (const known of KNOWN_LOCATIONS) {
      if (tools.some((t) => t.id === known.id)) continue;
      const at = firstExisting(known[platformKey]);
      if (at) add({ id: known.id, name: known.name, config: [`${kind}tool.${known.id}.path=${at}`] });
    }
  }

  const ksdiff = resolveOnPath('ksdiff') ?? (process.platform === 'darwin' ? firstExisting(KALEIDOSCOPE_BUNDLE) : null);
  if (ksdiff) {
    const bin = shQuote(ksdiff);
    add({
      id: 'kaleidoscope',
      name: 'Kaleidoscope',
      config:
        kind === 'diff'
          ? [`difftool.kaleidoscope.cmd=${bin} --partial-changeset --relative-path "$MERGED" -- "$LOCAL" "$REMOTE"`]
          : [
              `mergetool.kaleidoscope.cmd=${bin} --merge --output "$MERGED" --base "$BASE" -- "$LOCAL" --snapshot "$REMOTE" --snapshot`,
              'mergetool.kaleidoscope.trustExitCode=true',
            ],
    });
  }

  // FileMerge is the fallback of last resort: any tool the user installed on
  // purpose comes first when picking automatically.
  const ordered = [...tools.filter((t) => t.id !== 'opendiff'), ...tools.filter((t) => t.id === 'opendiff')];
  cache.set(kind, ordered);
  return ordered;
}

/** The first of `keys` set in the git config visible from `cwd`, or ''. */
function firstConfigValue(keys: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const next = (i: number) => {
      if (i >= keys.length) return resolve('');
      execFile(gitBin, ['config', '--get', keys[i]], { cwd, env: gitEnv() }, (err, stdout) => {
        const value = err ? '' : stdout.trim();
        if (value) resolve(value);
        else next(i + 1);
      });
    };
    next(0);
  });
}

/** The tool id git would use by itself (`diff.tool`, falling back to `merge.tool`), or ''. */
const configuredTool = (kind: ExternalToolKind, cwd: string) =>
  firstConfigValue(kind === 'diff' ? ['diff.tool', 'merge.tool'] : ['merge.tool'], cwd);

/**
 * Pick the tool to launch. An explicit `choice` must still be installed. With
 * no choice (`''`) the user's git config wins — unless it names a terminal-only
 * tool — then the first detected GUI tool.
 */
async function resolveTool(
  kind: ExternalToolKind,
  choice: string,
  cwd: string,
): Promise<{ ok: true; tool: DetectedTool } | { ok: false; message: string }> {
  const tools = await detectExternalTools(kind);
  if (choice) {
    const tool = tools.find((t) => t.id === choice);
    return tool
      ? { ok: true, tool }
      : { ok: false, message: `The ${kind} tool “${choice}” is no longer available. Pick another in Settings.` };
  }
  const configured = await configuredTool(kind, cwd);
  if (configured && !TERMINAL_ONLY.test(configured)) {
    // Detected under the same id: reuse its path hints. Otherwise git's own config drives it.
    return { ok: true, tool: tools.find((t) => t.id === configured) ?? { id: configured, name: configured, config: [] } };
  }
  if (tools[0]) return { ok: true, tool: tools[0] };
  return {
    ok: false,
    message: `No external ${kind} tool was found. Install one (e.g. Beyond Compare, Kaleidoscope, Meld) or set ${kind === 'diff' ? 'diff.tool' : 'merge.tool'} in your git config.`,
  };
}

/** The `git <kind>tool` arguments that run `tool` on the change `args` pick. */
async function toolArgs(kind: ExternalToolKind, cwd: string, tool: DetectedTool, args: string[]): Promise<string[]> {
  const config = tool.config.flatMap((c) => ['-c', c]);
  if (kind === 'merge') {
    // Keep git's `*.orig` backups off unless the user asked for them.
    if (!(await firstConfigValue(['mergetool.keepBackup'], cwd))) config.push('-c', 'mergetool.keepBackup=false');
    // Keep the LOCAL/REMOTE/BASE/BACKUP copies out of the worktree, so a merge
    // stopped mid-way (see `cancelMerge`) leaves nothing behind in the repo.
    if (!(await firstConfigValue(['mergetool.writeToTemp'], cwd))) config.push('-c', 'mergetool.writeToTemp=true');
  }
  // Always name the tool: without `--tool` and with no `diff.tool` set, git
  // guesses from its own list — vimdiff first — and hangs with no terminal.
  return [...config, `${kind}tool`, '-y', `--tool=${tool.id}`, ...args];
}

/** The last meaningful stderr line, for a one-line error toast. */
function lastLine(stderr: string): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

/**
 * Show one file's change in an external diff tool. Git keeps running until the
 * tool closes (it owns the temp files for the non-worktree side), but this
 * resolves as soon as the tool is evidently up, or git failed fast. `args`
 * pick the change —
 * revisions/flags, then `--` and the path(s): `['--cached', '--', f]`,
 * `['A', 'B', '--', f]`, `['--no-index', '--', '/dev/null', f]`…
 */
export async function openExternalDiff(cwd: string, choice: string, args: string[]): Promise<OpenResult> {
  const resolved = await resolveTool('diff', choice, cwd);
  if (!resolved.ok) return { status: 'error', message: resolved.message };
  const full = await toolArgs('diff', cwd, resolved.tool, args);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: OpenResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let stderr = '';
    const child = spawn(gitBin, full, {
      cwd,
      env: gitEnv({ GIT_TERMINAL_PROMPT: '0' }),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    child.once('error', (err) => settle({ status: 'error', message: err.message }));
    // `--no-index` passes on `git diff`'s own status: 1 just means "they differ".
    const okCodes = args.includes('--no-index') ? [0, 1] : [0];
    child.once('close', (code) => {
      if (code !== null && okCodes.includes(code)) settle({ status: 'ok' });
      else settle({ status: 'error', message: lastLine(stderr) || `${resolved.tool.name} exited with code ${code}.` });
    });
    // Still running after a moment: the tool is open. Git carries on in the background.
    setTimeout(() => settle({ status: 'ok' }), 2000);
  });
}

/** A line opening or closing a conflict block, as git writes them. */
const CONFLICT_MARKER = /^(<{7}|>{7})(?: |\r?$)/m;

/** Running merges by repo, so the app can stop waiting for one. */
const runningMerges = new Map<string, () => void>();

/** Kill a git child and everything it started in its process group (not a tool launched through the OS). */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => undefined);
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

/**
 * Resolve one conflicted file in an external merge tool; resolves when the
 * tool closes (or `cancelMerge` stops the wait).
 *
 * A tool whose exit code git doesn't trust (FileMerge and most others) makes
 * git check the file's timestamp and, if it looks unchanged, ask "Was the merge
 * successful?" — answering no restores the conflicted original over whatever
 * was saved. So the answer comes from here, by content: changed and free of
 * conflict markers is a yes; unchanged is a no (nothing to lose); changed but
 * still marked stops git before it can restore, keeping the partial merge on
 * disk for the conflict resolver.
 */
export async function openExternalMerge(cwd: string, choice: string, file: string): Promise<ExternalMergeStatus> {
  const resolved = await resolveTool('merge', choice, cwd);
  if (!resolved.ok) return { status: 'error', message: resolved.message };
  if (runningMerges.has(cwd)) return { status: 'error', message: 'A merge tool is already open for this repository.' };
  const full = await toolArgs('merge', cwd, resolved.tool, ['--', file]);
  const target = join(cwd, file);
  const before = await readFile(target).catch(() => null);

  return new Promise((resolve) => {
    let outcome: ExternalMergeStatus | null = null;
    let stderr = '';
    let stdout = '';
    const child = spawn(gitBin, full, {
      cwd,
      env: gitEnv({ GIT_TERMINAL_PROMPT: '0' }),
      stdio: ['pipe', 'pipe', 'pipe'],
      // Its own process group, so a cancel takes git, its shell and a child tool down together.
      detached: process.platform !== 'win32',
    });
    const stop = (status: ExternalMergeStatus) => {
      outcome ??= status;
      killTree(child);
    };
    runningMerges.set(cwd, () => stop({ status: 'cancelled' }));

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-4096);
      if (!/Was the merge successful \[y\/n\]\? *$/.test(stdout)) return;
      stdout = '';
      void readFile(target)
        .catch(() => null)
        .then((after) => {
          if (!after || (before && after.equals(before))) {
            outcome = { status: 'unchanged' };
            child.stdin?.end('n\n');
          } else if (CONFLICT_MARKER.test(after.toString('utf8'))) {
            stop({ status: 'unresolved' });
          } else {
            child.stdin?.end('y\n');
          }
        });
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    const finish = (status: ExternalMergeStatus) => {
      runningMerges.delete(cwd);
      resolve(outcome ?? status);
    };
    child.once('error', (err) => finish({ status: 'error', message: err.message }));
    child.once('close', (code) =>
      finish(
        code === 0
          ? { status: 'ok' }
          : { status: 'error', message: lastLine(stderr) || `${resolved.tool.name} exited with code ${code}.` },
      ),
    );
  });
}

/** Stop waiting for the merge tool running in `cwd`; the file stays as last saved, still conflicted. */
export function cancelMerge(cwd: string): void {
  runningMerges.get(cwd)?.();
}

/** How to finish a merge in `tool`, for the resolver's waiting state. */
function finishHint(tool: DetectedTool): string {
  // opendiff pipes into `cat`, which only ends when the FileMerge app quits.
  if (tool.id === 'opendiff') return 'Save the merge in FileMerge (⌘S), then quit FileMerge (⌘Q) to finish.';
  return `Save the merge in ${tool.name}, then close it to finish.`;
}

/** The tool a launch would use now, for labels and hints; null when none. */
export async function externalToolInfo(
  kind: ExternalToolKind,
  choice: string,
): Promise<{ name: string; finishHint: string } | null> {
  const resolved = await resolveTool(kind, choice, homedir());
  return resolved.ok ? { name: resolved.tool.name, finishHint: finishHint(resolved.tool) } : null;
}

/** The id/name list shown in Settings. */
export const toolOptions = (tools: DetectedTool[]): ToolOption[] => tools.map(({ id, name }) => ({ id, name }));
