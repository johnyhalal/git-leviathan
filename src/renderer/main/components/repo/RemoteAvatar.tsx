import { useState } from 'react';
import { GithubIcon, GitlabIcon, RemoteIcon } from '../../../../../assets/icons';

/**
 * Fallback icon for a remote, picked from its fetch URL's host: the GitHub mark
 * for GitHub, the GitLab mark for GitLab, and the generic remote glyph for
 * anything else (or an unknown/empty URL).
 */
export function remoteIcon(url: string | undefined, size: number) {
  const host = url?.toLowerCase() ?? '';
  if (host.includes('github.com')) return <GithubIcon size={size} />;
  if (host.includes('gitlab.com') || host.includes('gitlab.')) return <GitlabIcon size={size} />;
  return <RemoteIcon size={size} />;
}

/** The host and owner (org/user) parsed from a remote's fetch URL. */
export function parseRemoteUrl(url: string | undefined): { host: string; owner: string } | null {
  if (!url) return null;
  // scp-like syntax: "git@github.com:owner/repo.git".
  const scp = /^[^@]+@([^:]+):(.+)$/.exec(url);
  let host: string;
  let path: string;
  if (scp) {
    [, host, path] = scp;
  } else {
    // URL syntax: "https://github.com/owner/repo.git", "ssh://git@host/owner/…".
    const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(url);
    if (!match) return null;
    [, host, path] = match;
  }
  const owner = path.replace(/\.git$/, '').split('/')[0];
  if (!owner) return null;
  return { host: host.toLowerCase(), owner };
}

/**
 * Icon for a remote: GitHub serves an owner's avatar at `github.com/<owner>.png`,
 * so a remote pointing there is badged with the org/user's real avatar. Anything
 * else — or an avatar that fails to load — falls back to the host's glyph via
 * {@link remoteIcon}.
 */
export function RemoteAvatar({ url, size = 16 }: { url: string | undefined; size?: number }) {
  const [failed, setFailed] = useState(false);
  const parsed = parseRemoteUrl(url);
  const avatar =
    parsed && parsed.host.includes('github.com')
      ? `https://github.com/${encodeURIComponent(parsed.owner)}.png?size=40`
      : null;

  if (!avatar || failed) return remoteIcon(url, size);

  return (
    <img
      className="repo-remote-avatar"
      src={avatar}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}
