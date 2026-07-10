// Generate an ed25519 SSH keypair with pure Node crypto and encode both halves
// in OpenSSH's on-the-wire formats — no external `ssh-keygen` needed, so this
// works even on machines without an OpenSSH client installed (mirroring the way
// the app bundles its own git). Electron-free so the main process owns storage.
//
// The private-key layout follows OpenSSH's PROTOCOL.key; for an unencrypted
// ed25519 key it is small and fully specified, which is why we can emit it here.

import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';

export interface SshKeyPair {
  /** One-line OpenSSH public key: `ssh-ed25519 <base64> <comment>`. */
  publicKey: string;
  /** OpenSSH-format private key (`-----BEGIN OPENSSH PRIVATE KEY-----`). */
  privateKey: string;
  /** SHA256 fingerprint, e.g. `SHA256:abc…` (matches `ssh-keygen -lf`). */
  fingerprint: string;
  /** Legacy MD5 fingerprint, colon-separated hex, e.g. `a1:d7:56:…`. */
  fingerprintMd5: string;
}

const KEY_TYPE = 'ssh-ed25519';

/** A length-prefixed (uint32 big-endian) SSH "string". */
function sshString(data: Buffer | string): Buffer {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

/** A big-endian uint32. */
function sshUint32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

/** Wrap a base64 string into 70-char lines (OpenSSH's PEM line length). */
function wrap64(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 70) lines.push(b64.slice(i, i + 70));
  return lines.join('\n');
}

/**
 * Generate a fresh ed25519 keypair, labelled with `comment` (shown as the
 * trailing comment on the public key and stored inside the private key).
 */
export function generateSshKeyPair(comment: string): SshKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  // Node exports the raw key material inside fixed-shape DER: the 32-byte public
  // key is the tail of the SPKI, the 32-byte seed the tail of the PKCS8.
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const rawPublic = spki.subarray(spki.length - 32);
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  const seed = pkcs8.subarray(pkcs8.length - 32);
  // OpenSSH's private scalar for ed25519 is seed(32) || public(32).
  const rawPrivate = Buffer.concat([seed, rawPublic]);

  // The public key blob: string(type) + string(rawKey).
  const pubBlob = Buffer.concat([sshString(KEY_TYPE), sshString(rawPublic)]);

  // The private section: a random check int (written twice so a correct
  // decryption can be detected), the key, its comment, then 1,2,3… padding out
  // to the 8-byte block size that applies to the "none" cipher.
  const check = randomBytes(4);
  let priv = Buffer.concat([
    check,
    check,
    sshString(KEY_TYPE),
    sshString(rawPublic),
    sshString(rawPrivate),
    sshString(comment),
  ]);
  for (let pad = 1; priv.length % 8 !== 0; pad++) {
    priv = Buffer.concat([priv, Buffer.from([pad & 0xff])]);
  }

  const blob = Buffer.concat([
    Buffer.from('openssh-key-v1\0', 'binary'),
    sshString('none'), // cipher name
    sshString('none'), // kdf name
    sshString(''), // kdf options
    sshUint32(1), // number of keys
    sshString(pubBlob),
    sshString(priv),
  ]);

  const privateKeyPem =
    '-----BEGIN OPENSSH PRIVATE KEY-----\n' +
    wrap64(blob.toString('base64')) +
    '\n-----END OPENSSH PRIVATE KEY-----\n';

  // `ssh-keygen -lf` fingerprints the SHA256 of the raw public blob, base64 with
  // its padding stripped.
  const fingerprint =
    'SHA256:' +
    createHash('sha256').update(pubBlob).digest('base64').replace(/=+$/, '');

  // The classic MD5 fingerprint hosts show as colon-separated hex byte pairs.
  const fingerprintMd5 = (
    createHash('md5').update(pubBlob).digest('hex').match(/.{2}/g) ?? []
  ).join(':');

  return {
    publicKey: `${KEY_TYPE} ${pubBlob.toString('base64')} ${comment}`.trim(),
    privateKey: privateKeyPem,
    fingerprint,
    fingerprintMd5,
  };
}
