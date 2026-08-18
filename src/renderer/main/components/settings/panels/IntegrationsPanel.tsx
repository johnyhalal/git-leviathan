import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import {
  GithubIcon,
  GitlabIcon,
  SparkleIcon,
  type IconProps,
} from '../../../../../../assets/icons';
import type {
  ClaudeStatus,
  DeviceCodePrompt,
  IntegrationConnection,
  IntegrationProvider,
  IntegrationsState,
} from '../../../../../types/ipc';
import { SettingsSection } from '../SettingsSection';
import { ConnectingPrompt } from '../../integrations/ConnectingPrompt';
import { AddSshKey } from '../../integrations/AddSshKey';

interface ProviderMeta {
  provider: IntegrationProvider;
  name: string;
  Icon: ComponentType<IconProps>;
  /** Shown while disconnected — what connecting unlocks. */
  blurb: string;
  /** Where to mint a personal access token, and the scopes it needs. */
  tokenHelp: { url: string; scopes: string };
}

const PROVIDERS: ProviderMeta[] = [
  {
    provider: 'github',
    name: 'GitHub',
    Icon: GithubIcon,
    blurb: 'Connect your GitHub account to browse and clone your repositories.',
    tokenHelp: {
      url: 'https://github.com/settings/tokens/new?scopes=repo,read:org,write:public_key,write:ssh_signing_key,write:gpg_key&description=GitLeviathan',
      scopes:
        'repo, read:org, write:public_key, write:ssh_signing_key and write:gpg_key',
    },
  },
  {
    provider: 'gitlab',
    name: 'GitLab',
    Icon: GitlabIcon,
    blurb: 'Connect your GitLab account to browse and clone your repositories.',
    tokenHelp: {
      url: 'https://gitlab.com/-/user_settings/personal_access_tokens',
      scopes: 'read_api and write_repository',
    },
  },
];

interface TokenConnectProps {
  name: string;
  help: ProviderMeta['tokenHelp'];
  /** The collapsed link's text (differs for first-connect vs. switching). */
  toggleLabel: string;
  /** Validate + store the token; rejects with a user-facing message on failure. */
  onSubmit: (token: string) => Promise<void>;
}

/**
 * The "connect with a personal access token" escape hatch — shown under the
 * OAuth Connect button while disconnected, and as a "switch" affordance under an
 * OAuth-connected account. It's the workaround for orgs that restrict OAuth
 * apps: a token acts as the user, so it sidesteps app approval. Submitting
 * overwrites whatever credential the provider currently holds (single active
 * credential per provider). Collapsed to a single link until the user opts in.
 */
function TokenConnect({ name, help, toggleLabel, onSubmit }: TokenConnectProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = token.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      // On success the account flips to connected and this whole subtree
      // unmounts, so there's nothing to reset here.
      await onSubmit(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect.');
      setBusy(false);
    }
  };

  return (
    <div className="settings-row integration-token">
      {open ? (
        <>
          <p className="settings-desc">
            For organizations that restrict OAuth apps, connect with a personal
            access token instead — it needs the <strong>{help.scopes}</strong>{' '}
            scopes.{' '}
            <button
              type="button"
              className="integration-token-link"
              onClick={() => window.api.app.openExternal(help.url)}
            >
              Create one on {name} ↗
            </button>
          </p>
          <div className="integration-token-row">
            <input
              type="password"
              className="integration-token-input"
              placeholder="Paste your token"
              value={token}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
              }}
            />
            <button
              type="button"
              className="pill-btn pill-btn-green"
              disabled={busy || !token.trim()}
              onClick={() => void submit()}
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
          {error && <p className="settings-desc integration-error">{error}</p>}
        </>
      ) : (
        <button
          type="button"
          className="integration-token-toggle"
          onClick={() => setOpen(true)}
        >
          {toggleLabel}
        </button>
      )}
    </div>
  );
}

interface ConnectSectionProps extends ProviderMeta {
  connection: IntegrationConnection;
  prompt?: DeviceCodePrompt;
  busy: boolean;
  onConnect: () => void;
  onConnectToken: (token: string) => Promise<void>;
  onDisconnect: () => void;
}

/** One provider's connect/waiting/connected UI. */
function ConnectSection({
  provider,
  name,
  Icon,
  blurb,
  tokenHelp,
  connection,
  prompt,
  busy,
  onConnect,
  onConnectToken,
  onDisconnect,
}: ConnectSectionProps) {
  // While a device flow is in progress, show the code the user must enter.
  if (connection.status === 'connecting' && prompt) {
    return (
      <SettingsSection title={name}>
        <ConnectingPrompt prompt={prompt} busy={busy} onCancel={onDisconnect} />
      </SettingsSection>
    );
  }

  const connected = connection.status === 'connected';

  // Connected: identify the person (avatar + display name + @handle). Otherwise
  // show the provider mark with a blurb, or the last connect error.
  let label: string;
  let detail: string;
  if (connected) {
    label = connection.name || connection.account || name;
    const handle = connection.account ? `@${connection.account}` : 'Connected';
    // Spell out the credential in use — it's why a token-connected account can
    // see org repos the OAuth app can't.
    const via =
      connection.method === 'token' ? 'personal access token' : 'OAuth';
    detail = `${handle} · ${via}`;
  } else {
    label = name;
    detail = connection.error ?? blurb;
  }

  return (
    <SettingsSection title={name}>
      <div className="settings-row">
        <div className="integration-identity">
          {connected && connection.avatarUrl ? (
            <img
              className="integration-avatar"
              src={connection.avatarUrl}
              alt=""
              width={36}
              height={36}
            />
          ) : (
            <span className="integration-icon">
              <Icon size={22} />
            </span>
          )}
          <div className="settings-row-text">
            <span className="settings-label">{label}</span>
            <span
              className={
                connection.error && !connected
                  ? 'settings-desc integration-error'
                  : 'settings-desc'
              }
            >
              {detail}
            </span>
          </div>
        </div>
        <div className="settings-control">
          <button
            type="button"
            className={
              connected ? 'pill-btn pill-btn-red' : 'pill-btn pill-btn-green'
            }
            disabled={busy}
            onClick={connected ? onDisconnect : onConnect}
          >
            {connected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </div>
      {connected && <AddSshKey provider={provider} providerName={name} />}
      {!connected && (
        <TokenConnect
          name={name}
          help={tokenHelp}
          toggleLabel="Use a personal access token instead"
          onSubmit={onConnectToken}
        />
      )}
      {connected && connection.method !== 'token' && (
        <TokenConnect
          name={name}
          help={tokenHelp}
          toggleLabel="Switch to a personal access token"
          onSubmit={onConnectToken}
        />
      )}
      {connected && connection.method === 'token' && (
        <div className="settings-row integration-token">
          <button
            type="button"
            className="integration-token-toggle"
            disabled={busy}
            onClick={onConnect}
          >
            Switch to {name} OAuth sign-in
          </button>
        </div>
      )}
    </SettingsSection>
  );
}

const DISCONNECTED = (provider: IntegrationProvider): IntegrationConnection => ({
  provider,
  status: 'disconnected',
});

/**
 * Claude Code isn't an OAuth account like the Git hosts — "connecting" detects
 * the user's locally installed `claude` binary and remembers its path (its own
 * auth does the work). Connected shows the path/version + a Disconnect; otherwise
 * a Connect button that runs detection, surfacing an error if none is found.
 */
function ClaudeSection() {
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    window.api.claude.status().then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const connect = () => {
    setBusy(true);
    window.api.claude
      .connect()
      .then(setStatus)
      .finally(() => setBusy(false));
  };

  const disconnect = () => {
    setBusy(true);
    window.api.claude
      .disconnect()
      .then(setStatus)
      .finally(() => setBusy(false));
  };

  const connected = status?.connected ?? false;
  const label = 'Claude Code';
  let detail: string;
  if (connected) {
    detail = status?.version
      ? `Connected · ${status.version}`
      : `Connected · ${status?.binaryPath ?? ''}`;
  } else if (status?.error) {
    detail = status.error;
  } else {
    detail =
      'Connect your local Claude Code to generate commit messages — no account needed here.';
  }

  return (
    <SettingsSection title={label}>
      <div className="settings-row">
        <div className="integration-identity">
          <span className="integration-icon">
            <SparkleIcon size={22} />
          </span>
          <div className="settings-row-text">
            <span className="settings-label">{label}</span>
            <span
              className={
                status?.error && !connected
                  ? 'settings-desc integration-error'
                  : 'settings-desc'
              }
            >
              {detail}
            </span>
          </div>
        </div>
        <div className="settings-control">
          <button
            type="button"
            className={
              connected ? 'pill-btn pill-btn-red' : 'pill-btn pill-btn-green'
            }
            disabled={busy}
            onClick={connected ? disconnect : connect}
          >
            {connected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </div>
    </SettingsSection>
  );
}

/** Integrations settings — connect external Git hosts. */
export function IntegrationsPanel() {
  const [state, setState] = useState<IntegrationsState | null>(null);
  const [prompts, setPrompts] = useState<
    Partial<Record<IntegrationProvider, DeviceCodePrompt>>
  >({});
  // Errors from a connect() call that rejected outright (e.g. not configured);
  // polling failures instead arrive on the connection via onChange.
  const [localErrors, setLocalErrors] = useState<
    Partial<Record<IntegrationProvider, string>>
  >({});
  const [busy, setBusy] = useState<IntegrationProvider | null>(null);

  // Load current state and keep it in sync with main-side changes (a flow
  // completing, failing, or being canceled).
  useEffect(() => {
    let active = true;
    window.api.integrations.list().then((next) => {
      if (active) setState(next);
    });
    const unsubscribe = window.api.integrations.onChange((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const connect = async (provider: IntegrationProvider) => {
    setBusy(provider);
    setLocalErrors((prev) => ({ ...prev, [provider]: undefined }));
    try {
      const prompt = await window.api.integrations.connect(provider);
      setPrompts((prev) => ({ ...prev, [provider]: prompt }));
    } catch (err) {
      setLocalErrors((prev) => ({
        ...prev,
        [provider]: err instanceof Error ? err.message : 'Sign-in failed.',
      }));
    } finally {
      setBusy(null);
    }
  };

  // The token path validates on the main side; let its rejection bubble to the
  // form (TokenConnect shows it inline) rather than the row-level error slot.
  const connectWithToken = async (
    provider: IntegrationProvider,
    token: string,
  ) => {
    const next = await window.api.integrations.connectWithToken(provider, token);
    setState(next);
  };

  const disconnect = async (provider: IntegrationProvider) => {
    setBusy(provider);
    try {
      await window.api.integrations.disconnect(provider);
      setPrompts((prev) => ({ ...prev, [provider]: undefined }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {PROVIDERS.map((meta) => {
        const base = state?.[meta.provider] ?? DISCONNECTED(meta.provider);
        // Overlay a local connect() rejection onto the disconnected view.
        const connection: IntegrationConnection =
          base.status === 'disconnected' && localErrors[meta.provider]
            ? { ...base, error: localErrors[meta.provider] }
            : base;
        return (
          <ConnectSection
            key={meta.provider}
            {...meta}
            connection={connection}
            prompt={prompts[meta.provider]}
            busy={busy === meta.provider}
            onConnect={() => connect(meta.provider)}
            onConnectToken={(token) => connectWithToken(meta.provider, token)}
            onDisconnect={() => disconnect(meta.provider)}
          />
        );
      })}
      <ClaudeSection />
    </>
  );
}
