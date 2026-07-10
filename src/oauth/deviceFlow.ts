// OAuth 2.0 Device Authorization Grant (RFC 8628) — shared by the GitHub and
// GitLab clients, which differ only in their endpoints and REST shapes.
//
// A hardened desktop app can't safely hold a client *secret*, and device flow
// is built for exactly that: it needs only the public client id, no redirect
// URI and no loopback server. The user authorizes in their real browser while
// the app polls for the token.
//
// Pure networking — no Electron imports — so the main process keeps ownership of
// token storage, browser launch and IPC.

/** The two POST endpoints a provider exposes for the device flow. */
export interface DeviceEndpoints {
  /** POST here to obtain a device/user code pair. */
  deviceCodeUrl: string;
  /** POST here to poll for the access token. */
  tokenUrl: string;
}

/** What the user must do to authorize: enter `userCode` at `verificationUri`. */
export interface DeviceAuthorization {
  /** Secret the app polls with; never shown to the user. */
  deviceCode: string;
  /** Short code the user types into the browser. */
  userCode: string;
  /** Page the user opens to enter the code. */
  verificationUri: string;
  /** Verification URL with the code pre-filled, when the host provides one. */
  verificationUriComplete?: string;
  /** Seconds until both codes expire. */
  expiresIn: number;
  /** Minimum seconds to wait between token polls. */
  interval: number;
}

const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
} as const;

interface DeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

/** Ask the provider for a device/user code pair to begin the flow. */
export async function requestDeviceAuthorization(
  endpoints: DeviceEndpoints,
  clientId: string,
  scope: string,
  signal?: AbortSignal,
): Promise<DeviceAuthorization> {
  const res = await fetch(endpoints.deviceCodeUrl, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ client_id: clientId, scope }),
    signal,
  });
  // Even on a 4xx the provider returns an OAuth error body (e.g. `invalid_scope`
  // when the app isn't registered for a requested scope) — surface it rather
  // than a bare status code, so the real cause is visible.
  const data = (await res.json().catch(() => null)) as DeviceCodeResponse | null;
  if (data?.error) {
    throw new Error(oauthErrorMessage(data.error, data.error_description));
  }
  if (!res.ok || !data) {
    throw new Error(`Device authorization request failed (HTTP ${res.status}).`);
  }
  if (
    !data.device_code ||
    !data.user_code ||
    !data.verification_uri ||
    typeof data.expires_in !== 'number' ||
    typeof data.interval !== 'number'
  ) {
    throw new Error('The server returned an unexpected device-code response.');
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

interface AccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

/**
 * Poll until the user authorizes, then resolve with the access token. Honors
 * the `slow_down` back-off, the code's expiry, and the abort signal (aborting
 * rejects with an `AbortError`).
 */
export async function pollForAccessToken(
  endpoints: DeviceEndpoints,
  clientId: string,
  auth: DeviceAuthorization,
  signal?: AbortSignal,
): Promise<string> {
  let intervalMs = auth.interval * 1000;
  const deadline = Date.now() + auth.expiresIn * 1000;

  for (;;) {
    // Providers require waiting at least `interval` seconds between polls, so we
    // wait first (which also spaces out the very first request).
    await delay(intervalMs, signal);
    if (Date.now() >= deadline) {
      throw new Error('The code expired before authorization completed.');
    }

    const res = await fetch(endpoints.tokenUrl, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        client_id: clientId,
        device_code: auth.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
      signal,
    });
    const data = (await res.json()) as AccessTokenResponse;

    if (data.access_token) {
      return data.access_token;
    }
    switch (data.error) {
      case 'authorization_pending':
        break; // Not approved yet — keep polling at the current interval.
      case 'slow_down':
        // Back off as instructed (hosts bump the interval by ~5s).
        intervalMs = (data.interval ?? auth.interval + 5) * 1000;
        break;
      case 'expired_token':
        throw new Error('The code expired before authorization completed.');
      case 'access_denied':
        throw new Error('Authorization was denied.');
      default:
        throw new Error(oauthErrorMessage(data.error, data.error_description));
    }
  }
}

/** Extract the `rel="next"` URL from an RFC 5988 `Link` header (GitHub & GitLab). */
export function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function oauthErrorMessage(error?: string, description?: string): string {
  return description ?? error ?? 'Authorization failed.';
}

/** Promise-based sleep that rejects immediately if the flow is aborted. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
