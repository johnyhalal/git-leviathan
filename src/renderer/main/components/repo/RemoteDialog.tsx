import { useEffect, useState } from 'react';
import { CloseIcon } from '../../../../../assets/icons';
import type { RefsMutationResult, RemoteInfo } from '../../../../types/ipc';

interface RemoteDialogProps {
  /** The repository whose remotes are edited (drives the API calls). */
  repoPath: string;
  /** The remote being edited, or null to add a new one. */
  remote: RemoteInfo | null;
  /** Names already taken by another remote, which git would refuse. */
  existingNames: string[];
  /**
   * Run one remote mutation. The owner re-syncs the repo view on success; a
   * failure is shown inline here and keeps the dialog open.
   */
  onMutate: (run: () => Promise<RefsMutationResult>) => Promise<RefsMutationResult>;
  /** Dismiss the dialog. */
  onClose: () => void;
}

/**
 * Small popup for adding a remote, or editing one opened from its sidebar menu:
 * its name and URL, plus an optional separate push URL behind the "Different
 * push URL" checkbox (off by default; pushes then go to the URL above).
 * Editing only runs the git steps for the fields that actually changed — a
 * rename, then the URL, then the push URL — stopping at the first failure.
 */
export function RemoteDialog({
  repoPath,
  remote,
  existingNames,
  onMutate,
  onClose,
}: RemoteDialogProps) {
  const editing = remote !== null;
  const [name, setName] = useState(remote?.name ?? '');
  const [url, setUrl] = useState(remote?.url ?? '');
  const [separatePush, setSeparatePush] = useState(Boolean(remote?.pushUrl));
  const [pushUrl, setPushUrl] = useState(remote?.pushUrl ?? '');
  const [fetchAfterAdd, setFetchAfterAdd] = useState(true);
  // The remote's current name on disk, advanced once a rename lands, so a later
  // failing step (URL/push URL) retries against the right name.
  const [savedName, setSavedName] = useState(remote?.name ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  const trimmedPushUrl = pushUrl.trim();
  // The push URL to store: null clears it (pushes use the URL above).
  const desiredPushUrl = separatePush && trimmedPushUrl ? trimmedPushUrl : null;

  // Mirror the main process' checks so common mistakes point at the field.
  const nameError =
    trimmedName.length === 0
      ? null
      : !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(trimmedName) || trimmedName.includes('..')
        ? 'Use letters, digits, “.”, “_”, “-” or “/”.'
        : trimmedName !== savedName && existingNames.includes(trimmedName)
          ? `A remote named “${trimmedName}” already exists.`
          : null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, busy]);

  const canSubmit =
    !busy &&
    trimmedName.length > 0 &&
    trimmedUrl.length > 0 &&
    !nameError &&
    (!separatePush || trimmedPushUrl.length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (!editing) {
        const added = await onMutate(() =>
          window.api.repo.remoteAdd(repoPath, trimmedName, trimmedUrl, fetchAfterAdd),
        );
        if (added.status !== 'ok') return setError(added.message);
        if (desiredPushUrl) {
          const pushed = await onMutate(() =>
            window.api.repo.remoteSetPushUrl(repoPath, trimmedName, desiredPushUrl),
          );
          if (pushed.status !== 'ok') return setError(pushed.message);
        }
        onClose();
        return;
      }

      let current = savedName ?? remote.name;
      if (trimmedName !== current) {
        const renamed = await onMutate(() =>
          window.api.repo.remoteRename(repoPath, current, trimmedName),
        );
        if (renamed.status !== 'ok') return setError(renamed.message);
        current = trimmedName;
        setSavedName(current);
      }
      // The listed URL has any embedded credentials stripped, so only write it
      // back when the user actually changed it.
      if (trimmedUrl !== remote.url) {
        const target = current;
        const moved = await onMutate(() =>
          window.api.repo.remoteSetUrl(repoPath, target, trimmedUrl),
        );
        if (moved.status !== 'ok') return setError(moved.message);
      }
      // Same credential caveat as above, so compare against the listed value.
      if (desiredPushUrl !== (remote.pushUrl ?? null)) {
        const target = current;
        const pushed = await onMutate(() =>
          window.api.repo.remoteSetPushUrl(repoPath, target, desiredPushUrl),
        );
        if (pushed.status !== 'ok') return setError(pushed.message);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const title = editing ? `Edit remote “${remote.name}”` : 'Add a remote';

  return (
    <div className="settings-overlay" onClick={() => (busy ? undefined : onClose())}>
      <div
        className="settings-panel worktree-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>{title}</h2>
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

        <form
          className="settings-content form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="form-field">
            <span className="form-label">Name</span>
            <input
              className="form-input"
              autoFocus={!editing}
              value={name}
              placeholder="upstream"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => setName(event.target.value)}
            />
            {nameError ? (
              <span className="form-hint form-hint-error">{nameError}</span>
            ) : editing ? (
              <span className="form-hint">
                Renaming also renames its remote branches and updates branches tracking them.
              </span>
            ) : null}
          </label>

          <label className="form-field">
            <span className="form-label">{separatePush ? 'Fetch URL' : 'URL'}</span>
            <input
              className="form-input"
              autoFocus={editing}
              value={url}
              placeholder="https://github.com/owner/repo.git"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>

          <label className="form-check">
            <input
              type="checkbox"
              className="checkbox"
              checked={separatePush}
              onChange={(event) => setSeparatePush(event.target.checked)}
            />
            <span>Different push URL</span>
          </label>

          {separatePush && (
            <label className="form-field">
              <span className="form-label">Push URL</span>
              <input
                className="form-input"
                autoFocus
                value={pushUrl}
                placeholder="git@github.com:owner/repo.git"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => setPushUrl(event.target.value)}
              />
              <span className="form-hint">
                Pushes go here; fetches and pulls keep using the URL above.
              </span>
            </label>
          )}

          {!editing && (
            <label className="form-check">
              <input
                type="checkbox"
                className="checkbox"
                checked={fetchAfterAdd}
                onChange={(event) => setFetchAfterAdd(event.target.checked)}
              />
              <span>Fetch its branches after adding</span>
            </label>
          )}

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
              {editing ? (busy ? 'Saving…' : 'Save') : busy ? 'Adding…' : 'Add remote'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
