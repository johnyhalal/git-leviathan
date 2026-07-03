// GitLab OAuth 2.0 device flow client. Uses the shared device-flow core in
// ./deviceFlow; this module supplies GitLab's endpoints and REST mapping.
// GitLab's device grant is GA since 17.9 and needs only a public client id.
// https://docs.gitlab.com/api/oauth2/#device-authorization-grant-flow

import type { RemoteRepo } from '../types/ipc';
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
    throw new Error(`Failed to read the GitLab account (HTTP ${res.status}).`);
  }
  const user = (await res.json()) as GitlabUser;
  if (!user.username) {
    throw new Error('GitLab did not return an account name.');
  }
  return user.username;
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
