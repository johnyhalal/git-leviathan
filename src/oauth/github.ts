// GitHub OAuth 2.0 device flow client. The shared device-flow core lives in
// ./deviceFlow; this module just supplies GitHub's endpoints and REST mapping.
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

import type { RemoteRepo } from '../types/ipc';
import {
  nextPageUrl,
  pollForAccessToken as pollDeviceToken,
  requestDeviceAuthorization as requestDeviceAuth,
  type DeviceAuthorization,
  type DeviceEndpoints,
} from './deviceFlow';

const ENDPOINTS: DeviceEndpoints = {
  deviceCodeUrl: 'https://github.com/login/device/code',
  tokenUrl: 'https://github.com/login/oauth/access_token',
};
const API_BASE = 'https://api.github.com';

/** Begin GitHub's device flow. */
export function requestDeviceAuthorization(
  clientId: string,
  scope: string,
  signal?: AbortSignal,
): Promise<DeviceAuthorization> {
  return requestDeviceAuth(ENDPOINTS, clientId, scope, signal);
}

/** Poll GitHub for the access token. */
export function pollForAccessToken(
  clientId: string,
  auth: DeviceAuthorization,
  signal?: AbortSignal,
): Promise<string> {
  return pollDeviceToken(ENDPOINTS, clientId, auth, signal);
}

/** Headers for authenticated GitHub REST API requests. */
function apiHeaders(accessToken: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'GitLeviathan',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

interface GithubUser {
  login?: string;
}

/** Read the authenticated user's handle, for display and verification. */
export async function fetchUserLogin(
  accessToken: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${API_BASE}/user`, {
    headers: apiHeaders(accessToken),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Failed to read the GitHub account (HTTP ${res.status}).`);
  }
  const user = (await res.json()) as GithubUser;
  if (!user.login) {
    throw new Error('GitHub did not return an account name.');
  }
  return user.login;
}

interface GithubRepo {
  full_name: string;
  name: string;
  clone_url: string;
  private: boolean;
  description: string | null;
  updated_at: string | null;
  pushed_at: string | null;
}

/** Cap on pages fetched (100 repos each) so a huge account can't run forever. */
const MAX_REPO_PAGES = 10;

/**
 * List every repository the authenticated user can access (owned, collaborator
 * and organization), most-recently-updated first. Follows GitHub's `Link`
 * pagination up to a bounded number of pages.
 */
export async function fetchUserRepos(
  accessToken: string,
  signal?: AbortSignal,
): Promise<RemoteRepo[]> {
  const repos: RemoteRepo[] = [];
  let url: string | null =
    `${API_BASE}/user/repos?per_page=100&sort=updated` +
    '&affiliation=owner,collaborator,organization_member';

  for (let page = 0; url && page < MAX_REPO_PAGES; page++) {
    const res: Response = await fetch(url, {
      headers: apiHeaders(accessToken),
      signal,
    });
    if (!res.ok) {
      throw new Error(
        `Failed to list GitHub repositories (HTTP ${res.status}).`,
      );
    }
    const pageRepos = (await res.json()) as GithubRepo[];
    for (const repo of pageRepos) {
      repos.push({
        fullName: repo.full_name,
        name: repo.name,
        cloneUrl: repo.clone_url,
        private: repo.private,
        description: repo.description ?? undefined,
        updatedAt: repo.updated_at ?? repo.pushed_at ?? undefined,
      });
    }
    url = nextPageUrl(res.headers.get('link'));
  }
  return repos;
}
