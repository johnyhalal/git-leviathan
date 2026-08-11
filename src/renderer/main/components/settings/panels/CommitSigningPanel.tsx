import { useEffect, useState } from 'react';
import type {
  SigningCapabilities,
  SigningConfig,
  SigningConfigResult,
} from '../../../../../types/ipc';
import { SettingsSection } from '../SettingsSection';
import { SettingsRow } from '../SettingsRow';

/**
 * Commit Signing preferences. Slice 1 covers SSH signing (`gpg.format = ssh`):
 * generate or pick an SSH signing key and toggle signing commits/tags. OpenPGP
 * is detected only — shown with install guidance until its slice lands. All
 * state lives in the user's global git config, read/written via the signing API.
 */
export function CommitSigningPanel() {
  const [caps, setCaps] = useState<SigningCapabilities | null>(null);
  const [config, setConfig] = useState<SigningConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.api.signing.capabilities(),
      window.api.signing.getConfig(),
    ]).then(([c, cfg]) => {
      if (!active) return;
      setCaps(c);
      setConfig(cfg);
    });
    return () => {
      active = false;
    };
  }, []);

  // Fold a mutation's result into local state: adopt the fresh config or surface
  // the error. Every signing IPC call returns the same result shape.
  const apply = (result: SigningConfigResult) => {
    if (result.status === 'ok') {
      setConfig(result.config);
      setError(null);
    } else {
      setError(result.message);
    }
  };

  const run = async (action: string, call: () => Promise<SigningConfigResult>) => {
    setBusy(action);
    setError(null);
    try {
      apply(await call());
    } finally {
      setBusy(null);
    }
  };

  const sshAvailable = caps?.ssh.available ?? false;
  const gpgAvailable = caps?.gpg.available ?? false;
  const hasKey = Boolean(config?.signingKey);
  const working = busy !== null;

  return (
    <>
      <SettingsSection title="Signing method">
        <SettingsRow
          label="SSH"
          description={
            sshAvailable
              ? caps?.ssh.version
                ? `Sign with an SSH key — ${caps.ssh.version}.`
                : 'Sign commits and tags with an SSH key.'
              : 'ssh-keygen was not found, so SSH signing is unavailable.'
          }
        >
          <span className="settings-desc">{sshAvailable ? 'Available' : 'Unavailable'}</span>
        </SettingsRow>
        <SettingsRow
          label="GPG (OpenPGP)"
          description={
            gpgAvailable
              ? 'Detected. OpenPGP signing arrives in a later update.'
              : 'Install gpg (e.g. `brew install gnupg`) to sign with OpenPGP.'
          }
        >
          <span className="settings-desc">Coming soon</span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="SSH signing key">
        <SettingsRow
          label="Signing key"
          description={
            !sshAvailable
              ? 'Install OpenSSH to generate or choose a signing key.'
              : config?.signingKeyLabel
                ? config.signingKeyLabel
                : 'No signing key configured yet.'
          }
        >
          <button
            type="button"
            className="pill-btn pill-btn-green"
            disabled={!sshAvailable || working}
            onClick={() => run('generate', () => window.api.signing.generateSshKey())}
          >
            {busy === 'generate' ? 'Generating…' : 'Generate key'}
          </button>
          <button
            type="button"
            className="pill-btn pill-btn-gray"
            disabled={!sshAvailable || working}
            onClick={() => run('choose', () => window.api.signing.chooseSshKey())}
          >
            Choose file…
          </button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Sign by default">
        <SettingsRow
          label="Sign commits"
          description="Add a signature to every new commit."
        >
          <input
            type="checkbox"
            checked={config?.signCommits ?? false}
            disabled={!hasKey || working}
            onChange={(e) =>
              run('sign-commits', () =>
                window.api.signing.setConfig({ signCommits: e.target.checked }),
              )
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Sign tags"
          description="Add a signature to every new annotated tag."
        >
          <input
            type="checkbox"
            checked={config?.signTags ?? false}
            disabled={!hasKey || working}
            onChange={(e) =>
              run('sign-tags', () =>
                window.api.signing.setConfig({ signTags: e.target.checked }),
              )
            }
          />
        </SettingsRow>
        {error && (
          <div className="settings-row">
            <p className="settings-desc integration-error">{error}</p>
          </div>
        )}
      </SettingsSection>
    </>
  );
}
