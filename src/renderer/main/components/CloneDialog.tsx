import { useEffect, useState } from 'react';
import { CloneIcon, CloseIcon, FolderIcon } from '../../../../assets/icons';
import type {
  CloneProgress,
  IntegrationProvider,
  RemoteRepo,
  RepoInfo,
} from '../../../types/ipc';
import {
  CLONE_SOURCES,
  repoNameFromUrl,
  type CloneParams,
} from './clone/sources';
import { CloneUrlInput } from './clone/CloneUrlInput';
import { RepoSource } from './clone/RepoSource';

interface CloneDialogProps {
  /** Called once a clone finishes, with the freshly cloned repository. */
  onCloned: (repo: RepoInfo) => void;
  onClose: () => void;
}

/** Per-provider repo picker state, kept here so it survives sidemenu switches. */
type RepoState = Record<
  IntegrationProvider,
  { query: string; selected: RemoteRepo | null }
>;

const EMPTY_REPO_STATE: RepoState = {
  github: { query: '', selected: null },
  gitlab: { query: '', selected: null },
};

/**
 * Modal clone dialog. Owns the shared Destination and Clone button; the middle
 * input changes per source (URL field or repo picker). Destination and each
 * provider's filter/selection persist while switching the left rail.
 */
export function CloneDialog({ onCloned, onClose }: CloneDialogProps) {
  const [activeId, setActiveId] = useState(CLONE_SOURCES[0].id);
  const [destination, setDestination] = useState('');
  const [directory, setDirectory] = useState('');
  const [urlText, setUrlText] = useState('');
  const [repoState, setRepoState] = useState<RepoState>(EMPTY_REPO_STATE);

  const [progress, setProgress] = useState<CloneProgress | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cloning = progress !== null;

  // Pre-fill the destination with the last-used clone folder.
  useEffect(() => {
    let active = true;
    void window.api.repo.lastCloneDirectory().then((dir) => {
      if (active && dir) setDestination(dir);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Don't let Escape abandon the dialog mid-clone.
      if (event.key === 'Escape' && !cloning) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, cloning]);

  const chooseDestination = async () => {
    const dir = await window.api.repo.chooseDirectory();
    if (dir) setDestination(dir);
  };

  const startClone = async (params: CloneParams) => {
    setError(null);
    setProgress({ phase: 'Preparing…' });
    const unsubscribe = window.api.repo.onCloneProgress(setProgress);
    try {
      const result = await window.api.repo.clone(params);
      if (result.status === 'cloned') {
        onCloned(result.repo);
      } else {
        // 'canceled' returns silently to the form; 'error' shows the reason.
        if (result.status === 'error') setError(result.message);
        setProgress(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clone failed.');
      setProgress(null);
    } finally {
      unsubscribe();
      setCanceling(false);
    }
  };

  const cancelClone = async () => {
    setCanceling(true);
    // The pending clone() then resolves 'canceled', which resets the view.
    await window.api.repo.cancelClone();
  };

  const active =
    CLONE_SOURCES.find((source) => source.id === activeId) ?? CLONE_SOURCES[0];
  const provider = active.kind === 'repo' ? active.provider : undefined;

  // What the active source would clone.
  const resolvedUrl =
    active.kind === 'url'
      ? urlText.trim()
      : provider
        ? repoState[provider].selected?.cloneUrl ?? ''
        : '';

  // The folder name a clone lands in unless the user overrides it: the picked
  // repo's bare name, or the name derived from the typed URL.
  const defaultDirectory =
    active.kind === 'repo' && provider
      ? repoState[provider].selected?.name ?? ''
      : repoNameFromUrl(resolvedUrl);
  const resolvedDirectory = directory.trim() || defaultDirectory;

  const canClone =
    destination.length > 0 &&
    resolvedUrl.length > 0 &&
    resolvedDirectory.length > 0;

  const setProviderState = (
    key: IntegrationProvider,
    patch: Partial<RepoState[IntegrationProvider]>,
  ) => {
    setRepoState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  return (
    <div className="settings-overlay" onClick={cloning ? undefined : onClose}>
      <div
        className="settings-panel clone-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Clone repository"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>Clone Repository</h2>
          {!cloning && (
            <button
              type="button"
              className="icon-button"
              aria-label="Close clone dialog"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          )}
        </header>

        {cloning ? (
          <div className="clone-progress">
            <p className="clone-progress-phase">
              {canceling ? 'Canceling…' : progress.phase}
            </p>
            <div className="clone-progress-track">
              <div
                className={
                  progress.percent === undefined
                    ? 'clone-progress-bar is-indeterminate'
                    : 'clone-progress-bar'
                }
                style={
                  progress.percent === undefined
                    ? undefined
                    : { width: `${progress.percent}%` }
                }
              />
            </div>
            <div className="clone-progress-actions">
              <button
                type="button"
                className="clone-cancel"
                disabled={canceling}
                onClick={() => void cancelClone()}
              >
                {canceling ? 'Canceling…' : 'Cancel'}
              </button>
            </div>
          </div>
        ) : (
          <div className="settings-body">
            <nav
              className="settings-nav"
              role="tablist"
              aria-orientation="vertical"
              aria-label="Clone sources"
            >
              {CLONE_SOURCES.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  role="tab"
                  aria-selected={source.id === activeId}
                  className={source.id === activeId ? 'active' : undefined}
                  onClick={() => setActiveId(source.id)}
                >
                  {source.label}
                </button>
              ))}
            </nav>

            <div
              className="settings-content"
              role="tabpanel"
              aria-label={active.label}
            >
              <div className="clone-form">
                {error && <p className="clone-error">{error}</p>}

                <div className="clone-field">
                  <label className="clone-label" htmlFor="clone-destination">
                    Destination
                  </label>
                  <div className="clone-picker">
                    <input
                      id="clone-destination"
                      type="text"
                      className="clone-input"
                      placeholder="Choose a folder to clone into"
                      value={destination}
                      readOnly
                      onClick={() => void chooseDestination()}
                    />
                    <button
                      type="button"
                      className="clone-browse"
                      onClick={() => void chooseDestination()}
                    >
                      <FolderIcon size={16} />
                      <span>Browse…</span>
                    </button>
                  </div>
                </div>

                {active.kind === 'url' && (
                  <CloneUrlInput value={urlText} onChange={setUrlText} />
                )}
                {active.kind === 'repo' && provider && (
                  <RepoSource
                    provider={provider}
                    query={repoState[provider].query}
                    onQueryChange={(query) =>
                      setProviderState(provider, { query })
                    }
                    selected={repoState[provider].selected}
                    onSelect={(selected) =>
                      setProviderState(provider, { selected })
                    }
                  />
                )}

                {resolvedUrl.length > 0 && (
                  <div className="clone-field">
                    <label className="clone-label" htmlFor="clone-directory">
                      Directory name
                    </label>
                    <div className="clone-directory">
                      <span
                        className="clone-directory-prefix"
                        title={destination}
                      >
                        {destination ? `${destination}/` : ''}
                      </span>
                      <input
                        id="clone-directory"
                        type="text"
                        className="clone-input clone-directory-input"
                        placeholder={defaultDirectory || 'Repository name'}
                        value={directory}
                        onChange={(event) => setDirectory(event.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div className="clone-actions">
                  <button
                    type="button"
                    className="clone-submit"
                    disabled={!canClone}
                    onClick={() =>
                      void startClone({
                        url: resolvedUrl,
                        destination,
                        directory: resolvedDirectory,
                      })
                    }
                  >
                    <CloneIcon size={16} />
                    <span>Clone</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
