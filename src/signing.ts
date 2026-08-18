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
import { execFile, spawn } from 'node:child_process';
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

/** Locate `gpg` (an explicit `override` wins, e.g. the `gpg.program` config). */
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

/** A secret (private) OpenPGP key available for signing, from `gpg`. */
export interface GpgSecretKey {
  /** Long key id (16 hex), used to set `user.signingkey`. */
  keyId: string;
  /** Full 40-hex fingerprint (preferred `user.signingkey` value). */
  fingerprint: string;
  /** Primary user id, e.g. `Jane Doe <jane@example.com>`. */
  uid: string;
  /** True when gpg reports the key as expired or revoked. */
  expired: boolean;
}

/** Decode gpg's `--with-colons` C-style `\xNN` escapes in a user-id field. */
function decodeColonField(value: string): string {
  return value.replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/**
 * List the secret keys the `gpg` binary can sign with, parsed from its stable
 * `--with-colons` output. Each `sec` record starts a key; the following `fpr`
 * gives its fingerprint and the first `uid` its primary identity. Returns an
 * empty list when gpg is absent or has no secret keys.
 */
export async function listGpgSecretKeys(gpgBin: string): Promise<GpgSecretKey[]> {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync(
      gpgBin,
      ['--list-secret-keys', '--with-colons'],
      { timeout: PROBE_TIMEOUT_MS },
    ));
  } catch {
    return [];
  }

  const keys: GpgSecretKey[] = [];
  let current: GpgSecretKey | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const f = line.split(':');
    if (f[0] === 'sec') {
      if (current) keys.push(current);
      current = {
        keyId: f[4] ?? '',
        fingerprint: '',
        uid: '',
        expired: f[1] === 'e' || f[1] === 'r',
      };
    } else if (f[0] === 'fpr' && current && !current.fingerprint) {
      current.fingerprint = f[9] ?? '';
    } else if (f[0] === 'uid' && current && !current.uid) {
      current.uid = decodeColonField(f[9] ?? '');
    }
  }
  if (current) keys.push(current);
  return keys;
}

/**
 * Generate a new ed25519 OpenPGP **signing** key non-interactively and return
 * its 40-hex fingerprint. Driven by `gpg --batch --gen-key` reading a parameter
 * file on stdin; the key is created *without* a passphrase (`%no-protection`) so
 * git can sign headlessly with no pinentry prompt. `name`/`email` are sanitized
 * because the parameter file is line-based (a newline could inject a directive).
 */
export function generateGpgKey(
  gpgBin: string,
  name: string,
  email: string,
): Promise<string> {
  const safeName = name.replace(/[\r\n%<>()]/g, '').trim();
  const safeEmail = email.replace(/[\r\n%<>()\s]/g, '').trim();
  if (!safeName) return Promise.reject(new Error('A name is required.'));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(safeEmail)) {
    return Promise.reject(new Error('A valid email is required.'));
  }
  const params =
    [
      'Key-Type: eddsa',
      'Key-Curve: ed25519',
      'Key-Usage: sign',
      `Name-Real: ${safeName}`,
      `Name-Email: ${safeEmail}`,
      'Expire-Date: 0',
      '%no-protection',
      '%commit',
    ].join('\n') + '\n';

  return new Promise((resolve, reject) => {
    // `--status-fd=1` puts machine-readable status on stdout, incl. KEY_CREATED.
    const child = spawn(gpgBin, ['--batch', '--status-fd=1', '--gen-key']);
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const created = /\[GNUPG:\] KEY_CREATED \S+ ([0-9A-Fa-f]{40})/.exec(out);
      if (created) resolve(created[1]);
      else reject(new Error(err.trim() || `gpg exited with code ${code ?? '?'}.`));
    });
    child.stdin.end(params);
  });
}

/**
 * Export a key's ASCII-armored public block (`gpg --armor --export`), suitable
 * for uploading to GitHub/GitLab. Returns '' when the key can't be exported.
 */
export async function exportGpgPublicKey(
  gpgBin: string,
  fingerprint: string,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      gpgBin,
      ['--armor', '--export', fingerprint],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Load `passphrase` for the key `fingerprint` into gpg-agent's cache by doing a
 * throwaway loopback sign. Once cached, git's own signing (which goes through the
 * same agent) succeeds without a pinentry prompt — the workaround for signing a
 * protected key from a GUI app with no tty. The passphrase is written to a pipe
 * (fd 3), never argv, so it can't leak in the process list. Rejects on a bad
 * passphrase or gpg failure.
 */
export function primeGpgPassphrase(
  gpgBin: string,
  fingerprint: string,
  passphrase: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      gpgBin,
      [
        '--batch',
        '--yes',
        '--pinentry-mode',
        'loopback',
        '--passphrase-fd',
        '3',
        '--local-user',
        fingerprint,
        '--sign',
        '--output',
        '-', // stdout, which we discard via stdio 'ignore'
      ],
      { stdio: ['pipe', 'ignore', 'pipe', 'pipe'] },
    );
    let err = '';
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stderr?.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else if (/bad pass|no pass/i.test(err)) reject(new Error('Incorrect passphrase.'));
      else reject(new Error(err.trim() || `gpg exited with code ${code ?? '?'}.`));
    });
    const pass = child.stdio[3] as NodeJS.WritableStream | null;
    // Swallow EPIPE if gpg exits before reading (e.g. an unknown key).
    child.stdin?.on('error', () => {
      /* ignore */
    });
    pass?.on('error', () => {
      /* ignore */
    });
    pass?.end(passphrase);
    child.stdin?.end('prime');
  });
}
