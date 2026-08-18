import { Fragment, useEffect, useState } from 'react';
import type {
  GpgSecretKey,
  IntegrationProvider,
  IntegrationsState,
  SigningCapabilities,
  SigningConfig,
  SigningConfigResult,
  SigningFormat,
} from '../../../../../types/ipc';
import { SettingsSection } from '../SettingsSection';
import { SettingsRow } from '../SettingsRow';

/** Display names for the hosts a signing key can be uploaded to. */
const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
};
const PROVIDERS: IntegrationProvider[] = ['github', 'gitlab'];
/** The external binary each signing format drives. */
const PROGRAM_NAMES: Record<SigningFormat, string> = {
  ssh: 'ssh-keygen',
  openpgp: 'gpg',
};

/** A dropdown label for a gpg secret key: identity + short id, flagged if expired. */
function gpgKeyLabel(key: GpgSecretKey): string {
  const shortId = key.keyId.slice(-8) || key.fingerprint.slice(-8);
  const who = key.uid || 'OpenPGP key';
  return `${who} · ${shortId}${key.expired ? ' (expired)' : ''}`;
}

/**
 * Commit Signing preferences. Slice 1 covers SSH signing (`gpg.format = ssh`):
 * generate or pick an SSH signing key and toggle signing commits/tags. OpenPGP
 * is detected only — shown with install guidance until its slice lands. All
 * state lives in the user's global git config, read/written via the signing API.
 */
export function CommitSigningPanel() {
  const [caps, setCaps] = useState<SigningCapabilities | null>(null);
  const [config, setConfig] = useState<SigningConfig | null>(null);
  const [gpgKeys, setGpgKeys] = useState<GpgSecretKey[]>([]);
  // Inline "create a GPG key" form state (revealed from the key dropdown).
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  // Passphrase input for a protected GPG key (stored + used to prime gpg-agent).
  const [passphrase, setPassphrase] = useState('');
  const [connected, setConnected] = useState<IntegrationProvider[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A provider rejection tied to the `action` that produced it, rendered inline
  // (red/selectable) under that action's row. Successes are silent.
  const [notice, setNotice] = useState<{ action: string; text: string } | null>(
    null,
  );

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

  // Track which hosts are connected so we show an upload button per host, and
  // keep it live as accounts connect/disconnect while the panel is open.
  useEffect(() => {
    let active = true;
    const read = (state: IntegrationsState) => {
      if (!active) return;
      setConnected(PROVIDERS.filter((p) => state[p]?.status === 'connected'));
    };
    void window.api.integrations.list().then(read);
    const unsubscribe = window.api.integrations.onChange(read);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // When OpenPGP is the chosen method, list the gpg secret keys to pick from.
  useEffect(() => {
    if (config?.format !== 'openpgp') return;
    let active = true;
    void window.api.signing.listGpgKeys().then((keys) => {
      if (active) setGpgKeys(keys);
    });
    return () => {
      active = false;
    };
  }, [config?.format]);

  // Run a signing mutation and fold its result into local state. Only a provider
  // warning surfaces (as a notice tagged with this `action`, rendered inline
  // under the triggering row); successes apply silently.
  const run = async (action: string, call: () => Promise<SigningConfigResult>) => {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const result = await call();
      if (result.status === 'ok') {
        setConfig(result.config);
        if (result.warning) setNotice({ action, text: result.warning });
      } else {
        setError(result.message);
      }
    } finally {
      setBusy(null);
    }
  };

  // Generate a new GPG key from the inline form, then refresh the key list so the
  // freshly-created key shows as selected in the dropdown.
  const createGpgKey = async () => {
    setBusy('create-gpg');
    setError(null);
    setNotice(null);
    try {
      const result = await window.api.signing.generateGpgKey(
        newName.trim(),
        newEmail.trim(),
      );
      if (result.status === 'ok') {
        setConfig(result.config);
        setGpgKeys(await window.api.signing.listGpgKeys());
        setCreating(false);
        setNewName('');
        setNewEmail('');
      } else {
        setError(result.message);
      }
    } finally {
      setBusy(null);
    }
  };

  // Validate + store the GPG key passphrase (main primes gpg-agent to check it),
  // then clear the input on success.
  const savePassphrase = async () => {
    setBusy('set-passphrase');
    setError(null);
    setNotice(null);
    try {
      const result = await window.api.signing.setGpgPassphrase(passphrase);
      if (result.status === 'ok') {
        setConfig(result.config);
        setPassphrase('');
      } else {
        setError(result.message);
      }
    } finally {
      setBusy(null);
    }
  };

  const sshAvailable = caps?.ssh.available ?? false;
  const gpgAvailable = caps?.gpg.available ?? false;
  const hasKey = Boolean(config?.signingKey);
  const working = busy !== null;
  // The selected method: reflect gpg.format, treating unset as SSH (the app's
  // primary path). The selector writes an explicit value on change.
  const method: SigningFormat = config?.format === 'openpgp' ? 'openpgp' : 'ssh';
  // A key configured for the *selected* method: SSH signs with a key-file path,
  // OpenPGP with a key id. Switching methods leaves the other's `user.signingkey`
  // behind, so a bare `hasKey` isn't enough to enable signing.
  const keyIsPath =
    !!config?.signingKey &&
    (config.signingKey.includes('/') || config.signingKey.includes('\\'));
  const hasMethodKey = method === 'ssh' ? hasKey && keyIsPath : hasKey && !keyIsPath;
  // The binary that will actually run for this method: an explicit override, or
  // the one the app auto-detected.
  const programOverride = method === 'ssh' ? config?.sshProgram : config?.gpgProgram;
  const detectedProgram = method === 'ssh' ? caps?.ssh.path : caps?.gpg.path;
  const effectiveProgram = programOverride || detectedProgram || '';
  // Signing is "on" once either box is ticked; the method/key/upload config is
  // only shown then, so the panel stays minimal until the user opts in.
  const signingEnabled = (config?.signCommits ?? false) || (config?.signTags ?? false);

  return (
    <>


      <SettingsSection>
        <SettingsRow
            label="Sign commits"
            description="Add a signature to every new commit."
        >
          <input
              type="checkbox"
              checked={config?.signCommits ?? false}
              disabled={working}
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
              disabled={working}
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

      {signingEnabled && (
        <>
      <SettingsSection title="Signing method">
        <SettingsRow label="Method" description="How commits and tags are signed.">
          <select
            className="settings-select"
            value={method}
            disabled={working}
            onChange={(e) =>
              run('set-format', () =>
                window.api.signing.setConfig({
                  format: e.target.value as SigningFormat,
                }),
              )
            }
          >
            <option value="ssh">SSH</option>
            <option value="openpgp">OpenPGP (GPG)</option>
          </select>
        </SettingsRow>
        <SettingsRow
          label="Program"
          description={
            effectiveProgram
              ? programOverride
                ? `${effectiveProgram} (custom)`
                : `${effectiveProgram} (auto-detected)`
              : `${PROGRAM_NAMES[method]} was not found — choose the binary to use.`
          }
        >
          <button
            type="button"
            className="pill-btn pill-btn-gray"
            disabled={working}
            onClick={() =>
              run('choose-program', () => window.api.signing.chooseProgram(method))
            }
          >
            Choose…
          </button>
        </SettingsRow>
      </SettingsSection>

      {method === 'openpgp' && (
        <SettingsSection title="OpenPGP key">
          <SettingsRow
            label="Signing key"
            description={
              !gpgAvailable
                ? 'gpg was not found — set its path above or install gpg.'
                : gpgKeys.length === 0
                  ? 'No secret keys found. Create one with `gpg --full-generate-key`.'
                  : 'Choose which secret key signs your commits and tags.'
            }
          >
            {gpgAvailable ? (
              <select
                className="settings-select settings-select-truncate"
                value={config?.signingKey ?? ''}
                disabled={working}
                onChange={(e) => {
                  if (e.target.value === '__create__') {
                    setCreating(true);
                    return;
                  }
                  run('set-gpg-key', () =>
                    window.api.signing.setConfig({ signingKey: e.target.value }),
                  );
                }}
              >
                <option value="" disabled>
                  Choose a key…
                </option>
                {gpgKeys.map((key) => {
                  const value = key.fingerprint || key.keyId;
                  return (
                    <option key={value} value={value}>
                      {gpgKeyLabel(key)}
                    </option>
                  );
                })}
                <option value="__create__">＋ Create new key…</option>
              </select>
            ) : (
              <span className="settings-desc">gpg not found</span>
            )}
          </SettingsRow>
          {creating && (
            <>
              <SettingsRow label="Name" description="Shown on the key's identity.">
                <input
                  type="text"
                  className="settings-input"
                  placeholder="Your name"
                  value={newName}
                  disabled={working}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </SettingsRow>
              <SettingsRow
                label="Email"
                description="Use a verified account email so hosts can verify commits."
              >
                <input
                  type="email"
                  className="settings-input"
                  placeholder="you@example.com"
                  value={newEmail}
                  disabled={working}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </SettingsRow>
              <SettingsRow
                label="New key"
                description="Creates a passwordless ed25519 signing key with gpg."
              >
                <button
                  type="button"
                  className="pill-btn pill-btn-green"
                  disabled={working || !newName.trim() || !newEmail.trim()}
                  onClick={() => void createGpgKey()}
                >
                  {busy === 'create-gpg' ? 'Creating…' : 'Create'}
                </button>
                <button
                  type="button"
                  className="pill-btn pill-btn-gray"
                  disabled={working}
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
              </SettingsRow>
            </>
          )}
          {hasMethodKey && (
            <SettingsRow
              label="Passphrase"
              description={
                config?.hasPassphrase
                  ? 'Saved. Commits sign without prompting; cached in your OS keychain.'
                  : 'If this key has a passphrase, save it here so commits can sign without a prompt.'
              }
            >
              {config?.hasPassphrase ? (
                <button
                  type="button"
                  className="pill-btn pill-btn-gray"
                  disabled={working}
                  onClick={() =>
                    run('clear-passphrase', () =>
                      window.api.signing.clearGpgPassphrase(),
                    )
                  }
                >
                  {busy === 'clear-passphrase' ? 'Clearing…' : 'Clear'}
                </button>
              ) : (
                <>
                  <input
                    type="password"
                    className="settings-input"
                    placeholder="Key passphrase"
                    value={passphrase}
                    disabled={working}
                    autoComplete="off"
                    onChange={(e) => setPassphrase(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && passphrase) void savePassphrase();
                    }}
                  />
                  <button
                    type="button"
                    className="pill-btn pill-btn-green"
                    disabled={working || !passphrase}
                    onClick={() => void savePassphrase()}
                  >
                    {busy === 'set-passphrase' ? 'Saving…' : 'Save'}
                  </button>
                </>
              )}
            </SettingsRow>
          )}
        </SettingsSection>
      )}

      {method === 'ssh' && (
      <SettingsSection title="SSH signing key">
        <SettingsRow
          label="Signing key"
          description={
            !sshAvailable ? (
              'Install OpenSSH to generate or choose a signing key.'
            ) : config?.signingKeyLabel ? (
              config.signingKeyLabel
            ) : (
              <>
                Generate or choose a key.
                <br />
                This only configures signing locally.
              </>
            )
          }
        >
          <button
            type="button"
            className="pill-btn pill-btn-green"
            disabled={!sshAvailable || working}
            onClick={() => run('generate', () => window.api.signing.generateSshKey())}
          >
            {busy === 'generate'
              ? hasKey
                ? 'Regenerating…'
                : 'Generating…'
              : hasKey
                ? 'Regenerate key'
                : 'Generate key'}
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
      )}

      {hasMethodKey && (
        <SettingsSection title="Upload to accounts">
          {connected.length === 0 && (
            <SettingsRow
              label="Upload signing key"
              description="connect a GitHub or GitLab account to upload this key so signed commits show as verified."
            >
              <span className="settings-desc">No account connected</span>
            </SettingsRow>
          )}
          {connected.map((provider) => {
            const label = PROVIDER_LABELS[provider];
            const action = `upload-${provider}`;
            const isUploaded = (config?.uploadedTo ?? []).includes(provider);
            return (
              <Fragment key={provider}>
                <SettingsRow
                  label={label}
                  description={
                    isUploaded
                      ? `This key is on ${label}. Remove it to stop it verifying commits there.`
                      : `add this key to ${label} so signed commits show as verified.`
                  }
                >
                  <button
                    type="button"
                    className={isUploaded ? 'pill-btn pill-btn-red' : 'pill-btn pill-btn-green'}
                    disabled={working}
                    onClick={() =>
                      isUploaded
                        ? run(action, () =>
                            window.api.signing.removeSigningKey(provider),
                          )
                        : run(action, () =>
                            window.api.signing.uploadSigningKey(provider),
                          )
                    }
                  >
                    {busy === action
                      ? isUploaded
                        ? 'Removing…'
                        : 'Uploading…'
                      : isUploaded
                        ? 'Remove'
                        : `Upload to ${label}`}
                  </button>
                </SettingsRow>
                {notice?.action === action && (
                  <div className="settings-row">
                    <p className="settings-desc integration-error">{notice.text}</p>
                  </div>
                )}
              </Fragment>
            );
          })}
        </SettingsSection>
      )}
        </>
      )}
    </>
  );
}
