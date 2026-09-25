import { useEffect, useState } from 'react';
import { CloseIcon, PencilIcon, PlusIcon, TrashIcon } from '../../../../../assets/icons';
import type {
  GitflowConfig,
  GitflowConfigResult,
  RefsMutationResult,
  RepoConfig,
  RepoConfigResult,
  RemoteInfo,
} from '../../../../types/ipc';
import { RemoteAvatar } from './RemoteAvatar';
import { RemoteDialog } from './RemoteDialog';
import { GitflowSettingsForm } from './GitflowSettingsForm';
import { RepoLfsPanel } from './RepoLfsPanel';

interface RepoSettingsDialogProps {
  /** The repository these settings belong to. */
  repoPath: string;
  /** The current commit identity to pre-fill from, or null while it loads. */
  config: RepoConfig | null;
  /** Configured remotes; `undefined` while the repo's refs are (re)loading. */
  remotes: RemoteInfo[] | undefined;
  /**
   * Run a remote add/edit/remove. The owner re-syncs the repo view on success;
   * failures are shown inline here.
   */
  onRemoteMutate: (run: () => Promise<RefsMutationResult>) => Promise<RefsMutationResult>;
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
  { id: 'general', label: 'General', heading: 'General Settings' },
  { id: 'gitflow', label: 'Gitflow', heading: 'Gitflow Settings' },
  { id: 'lfs', label: 'LFS', heading: 'Git Large File Storage' },
];

/**
 * Modal for the repo's per-repository settings. Mirrors the app Settings dialog's
 * chrome — a category rail on the left, the active panel on the right — so it can
 * grow more tabs later. The commit-author identity (General tab) is written to the
 * repository's **local** git config (`user.name` / `user.email`), so it only ever
 * scopes this repo and never the user's global identity. Remotes can be added,
 * edited (in the shared remote popup) and removed from the same tab.
 */
export function RepoSettingsDialog({
  repoPath,
  config,
  remotes,
  onRemoteMutate,
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
  // The last loaded remotes, kept while the repo view reloads its refs after a
  // remote change so the list doesn't blink empty.
  const [shownRemotes, setShownRemotes] = useState<RemoteInfo[]>(remotes ?? []);
  // The add/edit remote popup: `null` adds one, a remote edits it; `false` = closed.
  const [remoteDialog, setRemoteDialog] = useState<RemoteInfo | null | false>(false);
  // The remote whose Remove was clicked, awaiting the in-row confirmation (the
  // shared confirm bar sits underneath this modal, so it can't be used here).
  const [armedRemove, setArmedRemove] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  useEffect(() => {
    if (remotes) setShownRemotes(remotes);
  }, [remotes]);

  // Pre-fill once the identity finishes loading (config starts null).
  useEffect(() => {
    if (config) setValues(config);
  }, [config]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // With the remote popup open, Escape belongs to it.
      if (event.key === 'Escape' && !busy && remoteDialog === false) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, busy, remoteDialog]);

  const removeRemote = async (name: string) => {
    setRemoteBusy(true);
    setRemoteError(null);
    const result = await onRemoteMutate(() => window.api.repo.remoteRemove(repoPath, name));
    setRemoteBusy(false);
    setArmedRemove(null);
    if (result.status === 'ok') setShownRemotes(result.refs.remotes);
    else setRemoteError(result.message);
  };

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
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="form-field">
        <span className="form-label">Commit author name</span>
        <input
          className="form-input"
          autoFocus
          value={values.userName}
          placeholder="Ada Lovelace"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => setField('userName', event.target.value)}
        />
        <span className="form-hint">
          Used to author commits in this repository (its local git config).
        </span>
      </label>

      <label className="form-field">
        <span className="form-label">Commit author email</span>
        <input
          className="form-input"
          value={values.userEmail}
          placeholder="ada@example.com"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => setField('userEmail', event.target.value)}
        />
        <span className="form-hint">
          Overrides your global identity for this repository only.
        </span>
      </label>

      <div className="form-field">
        <div className="repo-settings-remotes-header">
          <span className="form-label">Remotes</span>
          <button
            type="button"
            className="pill-btn pill-btn-green"
            aria-label="Add a remote"
            data-tooltip="Add a remote"
            disabled={remoteBusy}
            onClick={() => {
              setArmedRemove(null);
              setRemoteDialog(null);
            }}
          >
            <PlusIcon size={12} />
          </button>
        </div>
        {shownRemotes.length === 0 ? (
          <p className="form-hint">This repository has no remotes yet.</p>
        ) : (
          <ul className="repo-settings-remotes">
            {shownRemotes.map((remote) => (
              <li key={remote.name} className="repo-settings-remote">
                <RemoteAvatar url={remote.url} size={16} />
                <span className="repo-settings-remote-name">{remote.name}</span>
                <span className="repo-settings-remote-url">{remote.url || '—'}</span>
                {armedRemove === remote.name ? (
                  <span className="repo-settings-remote-confirm">
                    <button
                      type="button"
                      className="pill-btn pill-btn-gray"
                      disabled={remoteBusy}
                      onClick={() => setArmedRemove(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="pill-btn pill-btn-red"
                      disabled={remoteBusy}
                      onClick={() => void removeRemote(remote.name)}
                    >
                      {remoteBusy ? 'Removing…' : 'Remove'}
                    </button>
                  </span>
                ) : (
                  <span className="repo-settings-remote-actions">
                    <button
                      type="button"
                      className="icon-button repo-settings-remote-action"
                      aria-label={`Edit ${remote.name}`}
                      data-tooltip={`Edit ${remote.name}`}
                      disabled={remoteBusy}
                      onClick={() => {
                        setArmedRemove(null);
                        setRemoteDialog(remote);
                      }}
                    >
                      <PencilIcon size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-button repo-settings-remote-action"
                      aria-label={`Remove ${remote.name}`}
                      data-tooltip={`Remove ${remote.name} (nothing on the server is deleted)`}
                      disabled={remoteBusy}
                      onClick={() => {
                        setRemoteError(null);
                        setArmedRemove(remote.name);
                      }}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {remoteError && <span className="form-hint form-hint-error">{remoteError}</span>}
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-footer">
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
    <>
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
      {/* A sibling of the settings overlay, not a child, so its own overlay's
          outside-click and Escape close only the popup. */}
      {remoteDialog !== false && (
        <RemoteDialog
          repoPath={repoPath}
          remote={remoteDialog}
          existingNames={shownRemotes.map((remote) => remote.name)}
          onMutate={async (run) => {
            const result = await onRemoteMutate(run);
            if (result.status === 'ok') setShownRemotes(result.refs.remotes);
            return result;
          }}
          onClose={() => setRemoteDialog(false)}
        />
      )}
    </>
  );
}
