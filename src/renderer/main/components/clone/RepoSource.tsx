import { useEffect, useState } from 'react';
import type {
  DeviceCodePrompt,
  IntegrationConnection,
  IntegrationProvider,
  IntegrationsState,
  RemoteRepo,
} from '../../../../types/ipc';
import { ConnectingPrompt } from '../integrations/ConnectingPrompt';
import { RepoCombobox } from './RepoCombobox';

const LABELS: Record<IntegrationProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
};

interface RepoSourceProps {
  provider: IntegrationProvider;
  /** Controlled search + selection, owned by the dialog so they persist. */
  query: string;
  onQueryChange: (query: string) => void;
  selected: RemoteRepo | null;
  onSelect: (repo: RemoteRepo | null) => void;
}

/**
 * The middle input for a repo-based clone source: gates on the provider's
 * connection, loads its repositories, and drives a shared `RepoCombobox`.
 */
export function RepoSource({
  provider,
  query,
  onQueryChange,
  selected,
  onSelect,
}: RepoSourceProps) {
  const label = LABELS[provider];
  // null while the initial connection check is in flight.
  const [connection, setConnection] = useState<IntegrationConnection | null>(
    null,
  );
  const [repos, setRepos] = useState<RemoteRepo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Device-flow state for connecting inline, mirroring the settings panel.
  const [prompt, setPrompt] = useState<DeviceCodePrompt | undefined>(undefined);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const status = connection?.status ?? null;

  // Track connection state and react to connect/disconnect while open.
  useEffect(() => {
    let active = true;
    const apply = (state: IntegrationsState) => {
      if (active) setConnection(state[provider]);
    };
    window.api.integrations.list().then(apply);
    const unsubscribe = window.api.integrations.onChange(apply);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [provider]);

  const handleConnect = async () => {
    setConnectBusy(true);
    setConnectError(null);
    try {
      setPrompt(await window.api.integrations.connect(provider));
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setConnectBusy(false);
    }
  };

  const handleCancel = async () => {
    await window.api.integrations.disconnect(provider);
    setPrompt(undefined);
  };

  // (Re)load repositories whenever the account becomes connected.
  useEffect(() => {
    if (status !== 'connected') {
      setRepos(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    window.api.integrations
      .repositories(provider)
      .then((list) => {
        if (active) setRepos(list);
      })
      .catch((err: unknown) => {
        if (active) {
          setError(
            err instanceof Error ? err.message : 'Failed to load repositories.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status, provider]);

  if (status === null) {
    return (
      <div className="clone-field">
        <span className="clone-label">Repository</span>
        <p className="settings-empty">Checking your {label} connection…</p>
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className="clone-field">
        <span className="clone-label">Repository</span>
        {prompt ? (
          <ConnectingPrompt
            prompt={prompt}
            busy={connectBusy}
            onCancel={() => void handleCancel()}
          />
        ) : (
          <div className="integration-connecting-actions">
            <span className="settings-desc">Waiting for authorization…</span>
            <button
              type="button"
              className="settings-connect is-connected"
              onClick={() => void handleCancel()}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  if (status !== 'connected') {
    const message = connectError ?? connection?.error;
    return (
      <div className="clone-field">
        <span className="clone-label">Repository</span>
        <p className="settings-empty">
          Not connected to {label} yet. Connect to browse and clone your
          repositories.
        </p>
        {message && <p className="clone-error">{message}</p>}
        <button
          type="button"
          className="settings-connect clone-connect"
          disabled={connectBusy}
          onClick={() => void handleConnect()}
        >
          {connectBusy ? 'Connecting…' : `Connect ${label}`}
        </button>
      </div>
    );
  }

  return (
    <div className="clone-field">
      <span className="clone-label">Repository</span>
      <RepoCombobox
        repos={repos ?? []}
        query={query}
        onQueryChange={onQueryChange}
        selected={selected}
        onSelect={onSelect}
        loading={loading}
        error={error}
        emptyMessage={`No repositories found for this ${label} account.`}
      />
    </div>
  );
}
