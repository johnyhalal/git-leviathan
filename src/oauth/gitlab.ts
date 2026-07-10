// GitLab OAuth 2.0 device flow client. Uses the shared device-flow core in
// ./deviceFlow; this module supplies GitLab's endpoints and REST mapping.
// GitLab's device grant is GA since 17.9 and needs only a public client id.
// https://docs.gitlab.com/api/oauth2/#device-authorization-grant-flow

import type { IntegrationAccount, RemoteRepo } from '../types/ipc';
import {
  nextPageUrl,
  pollForAccessToken as pollDeviceToken,
  requestDeviceAuthorization as requestDeviceAuth,
  type DeviceAuthorization,
  type DeviceEndpoints,
} from './deviceFlow';

const ENDPOINTS: DeviceEndpoints = {
  deviceCodeUrl: 'https://gitlab.com/oauth/authorize_device',
  tokenUrl: 'https://gitlab.com/oauth/token',
};
const API_BASE = 'https://gitlab.com/api/v4';

/** Begin GitLab's device flow. */
export function requestDeviceAuthorization(
  clientId: string,
  scope: string,
  signal?: AbortSignal,
): Promise<DeviceAuthorization> {
  return requestDeviceAuth(ENDPOINTS, clientId, scope, signal);
}

/** Poll GitLab for the access token. */
export function pollForAccessToken(
  clientId: string,
  auth: DeviceAuthorization,
  signal?: AbortSignal,
): Promise<string> {
  return pollDeviceToken(ENDPOINTS, clientId, auth, signal);
}

/** Headers for authenticated GitLab REST API requests. */
function apiHeaders(accessToken: string): HeadersInit {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'GitLeviathan',
  };
}

interface GitlabUser {
  username?: string;
  name?: string | null;
  avatar_url?: string | null;
}

/** Read the authenticated user's profile, for display and verification. */
export async function fetchAccount(
  accessToken: string,
  signal?: AbortSignal,
): Promise<IntegrationAccount> {
  const res = await fetch(`${API_BASE}/user`, {
    headers: apiHeaders(accessToken),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Failed to read the GitLab account (HTTP ${res.status}).`);
  }
  const user = (await res.json()) as GitlabUser;
  if (!user.username) {
    throw new Error('GitLab did not return an account name.');
  }
  return {
    username: user.username,
    name: user.name ?? undefined,
    avatarUrl: user.avatar_url ?? undefined,
  };
}

interface GitlabKeyError {
  message?: string | Record<string, string[]>;
  error?: string;
}

/** Turn a failed key upload into one actionable line. */
async function keyUploadError(res: Response): Promise<string> {
  // A token minted before the write scope was granted can't add keys.
  if (res.status === 401 || res.status === 403) {
    return 'GitLab denied the request — disconnect and reconnect the account to grant SSH key access.';
  }
  let detail = '';
  try {
    const body = (await res.json()) as GitlabKeyError;
    if (typeof body.message === 'string') {
      detail = body.message;
    } else if (body.message && typeof body.message === 'object') {
      // GitLab reports validation errors as { field: ["msg", …] }.
      const parts = Object.entries(body.message).map(
        ([field, msgs]) => `${field} ${msgs.join(', ')}`,
      );
      detail = parts.join('; ');
    } else if (typeof body.error === 'string') {
      detail = body.error;
    }
  } catch {
    // Non-JSON body — fall back to the status code alone.
  }
  return `Failed to upload the SSH key to GitLab (HTTP ${res.status})${
    detail ? `: ${detail}` : ''
  }.`;
}

/**
 * Upload a public SSH key to the authenticated user's GitLab account. Resolves
 * with the created key's id, needed to remove it later.
 */
export async function uploadSshKey(
  accessToken: string,
  title: string,
  publicKey: string,
  signal?: AbortSignal,
): Promise<number> {
  const res = await fetch(`${API_BASE}/user/keys`, {
    method: 'POST',
    headers: { ...apiHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, key: publicKey }),
    signal,
  });
  if (!res.ok) {
    throw new Error(await keyUploadError(res));
  }
  const body = (await res.json()) as { id?: number };
  if (typeof body.id !== 'number') {
    throw new Error('GitLab did not return the new key id.');
  }
  return body.id;
}

/** Remove an SSH key (by its id) from the authenticated user's GitLab account. */
export async function deleteSshKey(
  accessToken: string,
  keyId: number,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/user/keys/${keyId}`, {
    method: 'DELETE',
    headers: apiHeaders(accessToken),
    signal,
  });
  // 404 means it's already gone — treat that as success.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to remove the SSH key from GitLab (HTTP ${res.status}).`);
  }
}

interface GitlabProject {
  path_with_namespace: string;
  name: string;
  http_url_to_repo: string;
  visibility: string;
  description: string | null;
  last_activity_at: string | null;
}

/** Cap on pages fetched (100 projects each) so a huge account can't run forever. */
const MAX_REPO_PAGES = 10;

/**
 * List the projects the authenticated user is a member of, most-recently-active
 * first. Follows GitLab's `Link` pagination up to a bounded number of pages.
 */
export async function fetchUserRepos(
  accessToken: string,
  signal?: AbortSignal,
): Promise<RemoteRepo[]> {
  const repos: RemoteRepo[] = [];
  let url: string | null =
    `${API_BASE}/projects?membership=true&per_page=100` +
    '&order_by=last_activity_at&sort=desc';

  for (let page = 0; url && page < MAX_REPO_PAGES; page++) {
    const res: Response = await fetch(url, {
      headers: apiHeaders(accessToken),
      signal,
    });
    if (!res.ok) {
      throw new Error(`Failed to list GitLab projects (HTTP ${res.status}).`);
    }
    const pageProjects = (await res.json()) as GitlabProject[];
    for (const project of pageProjects) {
      repos.push({
        fullName: project.path_with_namespace,
        name: project.name,
        cloneUrl: project.http_url_to_repo,
        private: project.visibility !== 'public',
        description: project.description ?? undefined,
        updatedAt: project.last_activity_at ?? undefined,
      });
    }
    url = nextPageUrl(res.headers.get('link'));
  }
  return repos;
}
