/**
 * Resolves the external binaries git delegates *signing* to, and probes whether
 * each signing method is usable on this machine.
 *
 * Unlike commit *authoring*, git does not sign objects itself: for
 * `gpg.format = ssh` it shells out to the system `ssh-keygen -Y sign`, and for
 * OpenPGP it shells out to `gpg`. The app bundles neither — so, exactly like
 * `claude.ts` locates the user's `claude` and `git.ts` its git, we resolve these
 * tools (explicit override → well-known install paths → login-shell lookup) and
 * report their availability so the UI can enable a method or guide the user to
 * install what's missing. This module is Electron-free; the main process owns all
 * key storage and git-config writes.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

const execFileAsync = promisify(execFile);

/** How long a version/probe invocation may run before we give up (ms). */
const PROBE_TIMEOUT_MS = 8_000;

/** Whether `p` is an existing, executable file (X_OK is meaningless on Windows). */
function isRunnable(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Well-known absolute install locations for a `name`d binary, per platform. */
function candidatePaths(name: string): string[] {
  if (process.platform === 'win32') {
    const windir = process.env.WINDIR || 'C:\\Windows';
    return [path.join(windir, 'System32', 'OpenSSH', `${name}.exe`)];
  }
  return [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    `/bin/${name}`,
  ];
}

/**
 * Ask the user's login shell where `name` resolves, picking up PATHs (Homebrew,
 * package managers) an Electron GUI never inherits on macOS. Absolute path or null.
 */
async function shellResolve(name: string): Promise<string | null> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('where', [name], {
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
    // `-lic` loads login+interactive rc files so PATH matches a real terminal.
    const { stdout } = await execFileAsync(shell, ['-lic', `command -v ${name}`], {
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

/** Locate a runnable binary: explicit override, then known paths, then the shell. */
async function resolveBin(
  name: string,
  override?: string | null,
): Promise<string | null> {
  if (override && isRunnable(override)) return override;
  for (const candidate of candidatePaths(name)) {
    if (isRunnable(candidate)) return candidate;
  }
  return shellResolve(name);
}

/** Locate the `ssh-keygen` git uses for SSH signing (`gpg.ssh.program` default). */
export function resolveSshKeygenBin(
  override?: string | null,
): Promise<string | null> {
  return resolveBin('ssh-keygen', override);
}

/** Locate `gpg` (only probed in this slice; OpenPGP signing lands later). */
export function resolveGpgBin(override?: string | null): Promise<string | null> {
  return resolveBin('gpg', override);
}

/** Availability + resolved path/version of one signing tool. */
export interface SigningToolInfo {
  available: boolean;
  path?: string;
  version?: string;
}

/** What the machine can sign with, driving the Commit Signing panel. */
export interface SigningCapabilities {
  ssh: SigningToolInfo;
  gpg: SigningToolInfo;
}

/**
 * OpenSSH prints its version on `ssh -V`'s *stderr* (there's no `ssh-keygen
 * --version`), e.g. `OpenSSH_9.6p1, LibreSSL 3.3.6`. We read it from the `ssh`
 * binary sitting next to the resolved `ssh-keygen`. Best-effort: a missing/quiet
 * `ssh` just leaves the version undefined — it never gates availability.
 */
async function readOpenSshVersion(sshKeygenPath: string): Promise<string | undefined> {
  const dir = path.dirname(sshKeygenPath);
  const sshName = process.platform === 'win32' ? 'ssh.exe' : 'ssh';
  const sshPath = path.join(dir, sshName);
  const bin = isRunnable(sshPath) ? sshPath : 'ssh';
  try {
    // `ssh -V` writes to stderr and exits non-zero on some builds, so read both.
    const { stdout, stderr } = await execFileAsync(bin, ['-V'], {
      timeout: PROBE_TIMEOUT_MS,
    }).catch((err: { stdout?: string; stderr?: string }) => ({
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    }));
    const match = /OpenSSH_[^\s,]+/.exec(`${stderr}${stdout}`);
    return match?.[0];
  } catch {
    return undefined;
  }
}

/** First-line version string from `gpg --version` (e.g. `gpg (GnuPG) 2.4.5`). */
async function readGpgVersion(gpgPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(gpgPath, ['--version'], {
      timeout: PROBE_TIMEOUT_MS,
    });
    return stdout.split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detect which signing methods are usable. SSH is available whenever a runnable
 * `ssh-keygen` is found (modern OpenSSH ≥ 8.0 supports `-Y sign`; git errors
 * clearly if it's too old); GPG availability is reported for the panel but
 * OpenPGP signing itself is a later slice.
 */
export async function probeSigningCapabilities(): Promise<SigningCapabilities> {
  const [sshKeygen, gpg] = await Promise.all([
    resolveSshKeygenBin(),
    resolveGpgBin(),
  ]);

  const ssh: SigningToolInfo = sshKeygen
    ? {
        available: true,
        path: sshKeygen,
        version: await readOpenSshVersion(sshKeygen),
      }
    : { available: false };

  const gpgInfo: SigningToolInfo = gpg
    ? { available: true, path: gpg, version: await readGpgVersion(gpg) }
    : { available: false };

  return { ssh, gpg: gpgInfo };
}
