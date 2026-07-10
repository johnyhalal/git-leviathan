import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import {
  GithubIcon,
  GitlabIcon,
  type IconProps,
} from '../../../../../../assets/icons';
import type {
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
}

const PROVIDERS: ProviderMeta[] = [
  {
    provider: 'github',
    name: 'GitHub',
    Icon: GithubIcon,
    blurb: 'Connect your GitHub account to browse and clone your repositories.',
  },
  {
    provider: 'gitlab',
    name: 'GitLab',
    Icon: GitlabIcon,
    blurb: 'Connect your GitLab account to browse and clone your repositories.',
  },
];

interface ConnectSectionProps extends ProviderMeta {
  connection: IntegrationConnection;
  prompt?: DeviceCodePrompt;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

/** One provider's connect/waiting/connected UI. */
function ConnectSection({
  provider,
  name,
  Icon,
  blurb,
  connection,
  prompt,
  busy,
  onConnect,
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
    detail = connection.account ? `@${connection.account}` : 'Connected';
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
    </SettingsSection>
  );
}

const DISCONNECTED = (provider: IntegrationProvider): IntegrationConnection => ({
  provider,
  status: 'disconnected',
});

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
            onDisconnect={() => disconnect(meta.provider)}
          />
        );
      })}
    </>
  );
}
