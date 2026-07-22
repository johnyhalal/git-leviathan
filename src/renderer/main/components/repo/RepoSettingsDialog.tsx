import { useEffect, useState } from 'react';
import { CloseIcon } from '../../../../../assets/icons';
import type {
  GitflowConfig,
  GitflowConfigResult,
  RepoConfig,
  RepoConfigResult,
  RemoteInfo,
} from '../../../../types/ipc';
import { RemoteAvatar } from './RemoteAvatar';
import { GitflowSettingsForm } from './GitflowSettingsForm';
import { RepoLfsPanel } from './RepoLfsPanel';

interface RepoSettingsDialogProps {
  /** The repository these settings belong to. */
  repoPath: string;
  /** The current commit identity to pre-fill from, or null while it loads. */
  config: RepoConfig | null;
  /** Configured remotes, shown read-only (managing them lives elsewhere for now). */
  remotes: RemoteInfo[];
  /** Persist the identity; resolves with the saved config or an error message. */
  onSave: (config: RepoConfig) => Promise<RepoConfigResult>;
  /** The repo's gitflow config for the Gitflow tab, or null when unconfigured. */
  gitflowConfig: GitflowConfig | null;
  /** Persist the gitflow config (initializes gitflow when previously unconfigured). */
  onGitflowSaveConfig: (config: GitflowConfig) => Promise<GitflowConfigResult>;
  /** Which tab to open on mount; defaults to the first (General). */
  initialTab?: RepoSettingsTabId;
  onClose: () => void;
  /** Called with the saved config once it lands (dialog then closes). */
  onSaved?: (config: RepoConfig) => void;
}

const EMPTY: RepoConfig = { userName: '', userEmail: '' };

/** Identifies a repo-settings tab; exported so other views can deep-link to one. */
export type RepoSettingsTabId = 'general' | 'gitflow' | 'lfs';

interface SettingsTab {
  id: RepoSettingsTabId;
  /** Sidebar rail label. */
  label: string;
  /** Content-pane header; defaults to `label` when omitted. */
  heading?: string;
}

/** The dialog's category tabs. General holds the commit identity + remotes. */
const TABS: SettingsTab[] = [
  { id: 'general', label: 'General' },
  { id: 'gitflow', label: 'Gitflow' },
  { id: 'lfs', label: 'LFS', heading: 'Git Large File Storage' },
];

/**
 * Modal for the repo's per-repository settings. Mirrors the app Settings dialog's
 * chrome — a category rail on the left, the active panel on the right — so it can
 * grow more tabs later. The commit-author identity (General tab) is written to the
 * repository's **local** git config (`user.name` / `user.email`), so it only ever
 * scopes this repo and never the user's global identity. Remotes are read-only.
 */
export function RepoSettingsDialog({
  repoPath,
  config,
  remotes,
  onSave,
  gitflowConfig,
  onGitflowSaveConfig,
  initialTab,
  onClose,
  onSaved,
}: RepoSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<RepoSettingsTabId>(initialTab ?? TABS[0].id);
  const [values, setValues] = useState<RepoConfig>(config ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill once the identity finishes loading (config starts null).
  useEffect(() => {
    if (config) setValues(config);
  }, [config]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, busy]);

  const setField = (key: keyof RepoConfig, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const canSubmit =
    !busy && values.userName.trim().length > 0 && values.userEmail.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const trimmed: RepoConfig = {
      userName: values.userName.trim(),
      userEmail: values.userEmail.trim(),
    };
    const result = await onSave(trimmed);
    setBusy(false);
    if (result.status === 'ok') {
      onSaved?.(result.config);
      onClose();
    } else {
      setError(result.message);
    }
  };

  const activeDef = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];
  const activeLabel = activeDef.label;
  const activeHeading = activeDef.heading ?? activeDef.label;

  const renderGeneral = () => (
    <form
      className="pr-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="pr-form-field">
        <span className="pr-form-label">Commit author name</span>
        <input
          autoFocus
          value={values.userName}
          placeholder="Ada Lovelace"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => setField('userName', event.target.value)}
        />
        <span className="gitflow-form-hint">
          Used to author commits in this repository (its local git config).
        </span>
      </label>

      <label className="pr-form-field">
        <span className="pr-form-label">Commit author email</span>
        <input
          value={values.userEmail}
          placeholder="ada@example.com"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => setField('userEmail', event.target.value)}
        />
        <span className="gitflow-form-hint">
          Overrides your global identity for this repository only.
        </span>
      </label>

      {remotes.length > 0 && (
        <div className="pr-form-field">
          <span className="pr-form-label">Remotes</span>
          <ul className="repo-settings-remotes">
            {remotes.map((remote) => (
              <li key={remote.name} className="repo-settings-remote">
                <RemoteAvatar url={remote.url} size={16} />
                <span className="repo-settings-remote-name">{remote.name}</span>
                <span className="repo-settings-remote-url">{remote.url || '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="pr-form-error">{error}</p>}

      <div className="pr-dialog-footer">
        <button
          type="button"
          className="pill-btn pill-btn-gray"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="submit" className="pill-btn pill-btn-green" disabled={!canSubmit}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );

  return (
    <div className="settings-overlay" onClick={() => (busy ? undefined : onClose())}>
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Repository settings"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>Repository settings</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="settings-body">
          <nav
            className="settings-nav"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Repository settings categories"
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeTab}
                className={tab.id === activeTab ? 'active' : undefined}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="settings-content" role="tabpanel" aria-label={activeLabel}>
            <h3 className="settings-content-title">{activeHeading}</h3>
            {activeTab === 'general' && renderGeneral()}
            {activeTab === 'gitflow' && (
              <GitflowSettingsForm
                config={gitflowConfig}
                onSave={onGitflowSaveConfig}
                onClose={onClose}
              />
            )}
            {activeTab === 'lfs' && <RepoLfsPanel repoPath={repoPath} />}
          </div>
        </div>
      </div>
    </div>
  );
}
