import { useEffect, useState } from 'react';
import type { IntegrationProvider, SshKeyInfo } from '../../../../types/ipc';

interface AddSshKeyProps {
  provider: IntegrationProvider;
  providerName: string;
}

/**
 * The connected-account row for the provider's SSH key. One key per integration:
 * when none exists it offers to generate and upload one; when one exists it shows
 * its fingerprint, on-disk path and public key, with a button to revoke it.
 */
export function AddSshKey({ provider, providerName }: AddSshKeyProps) {
  const [key, setKey] = useState<SshKeyInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.api.integrations.sshKeys(provider).then((existing) => {
      if (active) setKey(existing[0] ?? null);
    });
    return () => {
      active = false;
    };
  }, [provider]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      setKey(await window.api.integrations.addSshKey(provider));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the SSH key.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const remaining = await window.api.integrations.removeSshKey(provider);
      setKey(remaining[0] ?? null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not remove the SSH key.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-row integration-sshkey">
      <div className="integration-sshkey-head">
        <span className="settings-label">SSH Key</span>
        <button
          type="button"
          className={key ? 'pill-btn pill-btn-red' : 'pill-btn pill-btn-green'}
          disabled={busy}
          onClick={key ? remove : add}
        >
          {busy
            ? key
              ? 'Deleting…'
              : 'Adding…'
            : key
              ? 'Remove and Delete'
              : 'Add SSH key'}
        </button>
      </div>
      {key ? (
        <div className="integration-sshkey-result">
          <span className="settings-desc">
            <strong>{key.title}</strong>
          </span>
          <span className="settings-desc">
            Fingerprint: <code>{key.fingerprintMd5}</code>
          </span>
        </div>
      ) : (
        <span className="settings-desc">
          Generate a new ed25519 key and upload it to {providerName}.
        </span>
      )}
      {error && (
        <span className="settings-desc integration-error">{error}</span>
      )}
    </div>
  );
}
