/**
 * Minimal, privacy-respecting usage telemetry sent to Aptabase.
 *
 * We hand-roll the Aptabase ingest call rather than pull in `@aptabase/electron`
 * — the same "bring-your-own / hand-encode it" philosophy as `git.ts` (bundled
 * git over a library), `claude.ts` (the user's own CLI) and `ssh/keygen.ts`
 * (OpenSSH key formats by hand). The wire protocol is a single JSON POST, so a
 * dependency buys us nothing and costs us a supply-chain surface.
 *
 * What we send: three named events (`app_opened`, `commit_created`,
 * `update_checked`), each tagged with a stable anonymous user id (a random UUID
 * persisted in settings.json) plus the coarse system properties Aptabase's
 * dashboard renders (OS, app version, locale). No repo paths, no file names, no
 * commit messages, no PII. The whole subsystem is a no-op unless the user has
 * usage analytics enabled (on by default, toggled from General settings) and a
 * valid app key is configured.
 *
 * Every call is fire-and-forget, time-bounded, and swallows its own errors: a
 * telemetry failure (offline, blocked, rate-limited) must never surface to the
 * user or break app flow.
 */
import { app } from 'electron';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

// Public ingest key — safe to embed (it only authorizes writing events, like a
// web analytics site id). A launch-time env var wins so a build can be pointed
// at a different project without a rebuild.
const APP_KEY = process.env.APTABASE_APP_KEY || 'A-EU-9726499343';

/** Time budget for one ingest POST; a slow network must not pile up requests. */
const REQUEST_TIMEOUT_MS = 5000;

/** Labels the Aptabase dashboard groups by; keep to its known OS names. */
function osName(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return process.platform;
  }
}

/**
 * Resolve the ingest base URL from the app key's region segment
 * (`A-<REGION>-<hash>`). Self-hosted keys (`A-SH-…`) need a base URL we don't
 * have, so they disable telemetry rather than guess.
 */
function baseUrlFor(key: string): string | null {
  const region = key.split('-')[1];
  switch (region) {
    case 'US':
      return 'https://us.aptabase.com';
    case 'EU':
      return 'https://eu.aptabase.com';
    case 'DEV':
      return 'http://localhost:3000';
    default:
      return null;
  }
}

const baseUrl = baseUrlFor(APP_KEY);

// A session id is minted per app launch; Aptabase stitches an event stream to it.
const sessionId = randomUUID();

interface TelemetryConfig {
  /** Read fresh each send so a settings toggle takes effect immediately. */
  isEnabled: () => boolean;
  /** Stable anonymous user id (persisted UUID). */
  userId: string;
}

let config: TelemetryConfig | null = null;

/** Wire up the accessors the main process owns (enabled flag + user id). */
export function configureTelemetry(cfg: TelemetryConfig): void {
  config = cfg;
}

/**
 * Send one named usage event with optional custom props. Fire-and-forget: it
 * returns immediately and never rejects. No-op when analytics is off, the key
 * is unconfigured, or its region is unknown.
 */
export function trackEvent(
  eventName: string,
  props: Record<string, string | number | boolean> = {},
): void {
  if (!config || !config.isEnabled()) return;
  if (!APP_KEY || !baseUrl) return;

  const body = {
    timestamp: new Date().toISOString(),
    sessionId,
    eventName,
    systemProps: {
      isDebug: !app.isPackaged,
      locale: app.getLocale() || 'en',
      osName: osName(),
      osVersion: os.release(),
      appVersion: app.getVersion(),
      sdkVersion: 'gitleviathan-telemetry@1',
    },
    // The anonymous user id rides as a normal prop so every event is
    // attributable to one install without Aptabase needing a user concept.
    props: { userId: config.userId, ...props },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  void fetch(`${baseUrl}/api/v0/event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'App-Key': APP_KEY,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .catch(() => {
      // Offline, aborted, blocked, rate-limited — telemetry is best-effort.
    })
    .finally(() => clearTimeout(timeout));
}
