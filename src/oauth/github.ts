// GitHub OAuth 2.0 device flow client. The shared device-flow core lives in
// ./deviceFlow; this module just supplies GitHub's endpoints and REST mapping.
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

import type {
  IntegrationAccount,
  NewPullRequest,
  PullRequestState,
  PullRequestSummary,
  RemoteRepo,
} from '../types/ipc';
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
  name?: string | null;
  avatar_url?: string;
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
    throw new Error(`Failed to read the GitHub account (HTTP ${res.status}).`);
  }
  const user = (await res.json()) as GithubUser;
  if (!user.login) {
    throw new Error('GitHub did not return an account name.');
  }
  return {
    username: user.login,
    name: user.name ?? undefined,
    avatarUrl: user.avatar_url,
  };
}

interface GithubKeyError {
  message?: string;
  errors?: { message?: string }[];
}

/** Turn a failed key upload into one actionable line. */
async function keyUploadError(res: Response): Promise<string> {
  // A token minted before the SSH-key scope was added can't write keys; GitHub
  // answers 404/403, which is otherwise baffling here — point at reconnecting.
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    return 'GitHub denied the request — disconnect and reconnect the account to grant SSH key access.';
  }
  let detail = '';
  try {
    const body = (await res.json()) as GithubKeyError;
    detail = body.message ?? '';
    const first = body.errors?.[0]?.message;
    if (first) detail = detail ? `${detail}: ${first}` : first;
  } catch {
    // Non-JSON body — fall back to the status code alone.
  }
  return `Failed to upload the SSH key to GitHub (HTTP ${res.status})${
    detail ? `: ${detail}` : ''
  }.`;
}

/**
 * Upload a public SSH key to the authenticated user's GitHub account. Resolves
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
    throw new Error('GitHub did not return the new key id.');
  }
  return body.id;
}

/** Remove an SSH key (by its id) from the authenticated user's GitHub account. */
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
    throw new Error(`Failed to remove the SSH key from GitHub (HTTP ${res.status}).`);
  }
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

// ---- Pull requests --------------------------------------------------------

interface GithubPull {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  merged_at: string | null;
  html_url: string;
  body: string | null;
  created_at: string | null;
  updated_at: string | null;
  user: { login?: string; avatar_url?: string } | null;
  head: { ref?: string } | null;
  base: { ref?: string } | null;
}

/** Collapse GitHub's `state` + `draft` + `merged_at` into one normalized state. */
function pullState(pull: GithubPull): PullRequestState {
  if (pull.merged_at) return 'merged';
  if (pull.state === 'closed') return 'closed';
  if (pull.draft) return 'draft';
  return 'open';
}

/** Map a raw GitHub pull to the shared summary shape. */
function toSummary(pull: GithubPull): PullRequestSummary {
  return {
    number: pull.number,
    title: pull.title,
    author: pull.user?.login ?? 'unknown',
    authorAvatarUrl: pull.user?.avatar_url,
    state: pullState(pull),
    sourceBranch: pull.head?.ref ?? '',
    targetBranch: pull.base?.ref ?? '',
    url: pull.html_url,
    body: pull.body ?? undefined,
    createdAt: pull.created_at ?? undefined,
    updatedAt: pull.updated_at ?? undefined,
  };
}

/** Pull out one actionable line from a failed GitHub API response. */
async function apiError(res: Response, fallback: string): Promise<string> {
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    return `${fallback} — GitHub denied the request; disconnect and reconnect the account to refresh access.`;
  }
  try {
    const body = (await res.json()) as GithubKeyError;
    const first = body.errors?.[0]?.message;
    const detail = first ?? body.message ?? '';
    if (detail) return `${fallback}: ${detail}.`;
  } catch {
    // Non-JSON body — fall back to the status code alone.
  }
  return `${fallback} (HTTP ${res.status}).`;
}

/**
 * List a repository's pull requests (open and closed), most-recently-updated
 * first. A single page (up to 50) is plenty for the sidebar.
 */
export async function fetchPullRequests(
  accessToken: string,
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<PullRequestSummary[]> {
  const url =
    `${API_BASE}/repos/${owner}/${repo}/pulls` +
    '?state=all&per_page=50&sort=updated&direction=desc';
  const res = await fetch(url, { headers: apiHeaders(accessToken), signal });
  if (!res.ok) {
    throw new Error(await apiError(res, 'Failed to list GitHub pull requests'));
  }
  const pulls = (await res.json()) as GithubPull[];
  return pulls.map(toSummary);
}

/**
 * Open a new issue on `owner/repo` and return its number and web URL. `labels`
 * are applied when they already exist on the repo; GitHub silently ignores
 * unknown ones rather than failing, so no pre-check is needed.
 */
export async function createIssue(
  accessToken: string,
  owner: string,
  repo: string,
  input: { title: string; body: string; labels: string[] },
  signal?: AbortSignal,
): Promise<{ number: number; url: string }> {
  const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: { ...apiHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      labels: input.labels,
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(await apiError(res, 'Failed to create the issue'));
  }
  const issue = (await res.json()) as { number: number; html_url: string };
  return { number: issue.number, url: issue.html_url };
}

/** Open a new pull request and return it in the shared summary shape. */
export async function createPullRequest(
  accessToken: string,
  owner: string,
  repo: string,
  input: NewPullRequest,
  signal?: AbortSignal,
): Promise<PullRequestSummary> {
  const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: { ...apiHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: input.title,
      head: input.sourceBranch,
      base: input.targetBranch,
      body: input.body,
      draft: input.draft,
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(await apiError(res, 'Failed to open the pull request'));
  }
  return toSummary((await res.json()) as GithubPull);
}
