import { useEffect, useState } from 'react';
import { CloseIcon } from '../../../../../assets/icons';
import type { SubmoduleAddOptions } from '../../../../types/ipc';
import { repoNameFromUrl } from '../clone/sources';

interface SubmoduleDialogProps {
  /** The repository the submodule is added to (drives the API call). */
  repoPath: string;
  /** Paths already taken by an existing submodule, which git would refuse. */
  existingPaths: string[];
  /** Dismiss the dialog. */
  onClose: () => void;
  /** A submodule was added: refs should reload. */
  onAdded: () => void;
}

/**
 * Modal form for adding a submodule. Mirrors the worktree/new-PR dialog shell.
 * Give the clone URL, the path inside this repository to check it out at (a
 * folder named after the repo is suggested), and optionally a branch to track —
 * which is what later makes "update to remote" meaningful. The call goes through
 * `repo.submoduleAdd`, which clones it and stages the `.gitmodules` entry.
 */
export function SubmoduleDialog({
  repoPath,
  existingPaths,
  onClose,
  onAdded,
}: SubmoduleDialogProps) {
  const [url, setUrl] = useState('');
  // Empty means "use the suggested path" (shown as the placeholder), so the
  // suggestion keeps tracking the URL until the user types their own.
  const [location, setLocation] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedUrl = url.trim();
  const suggested = repoNameFromUrl(trimmedUrl);
  // What we'll actually add at: the typed path, or the suggestion when blank.
  const modulePath = (location.trim() || suggested).replace(/\/+$/, '');

  // Mirror the main process' own checks so the common mistakes are caught before
  // a round trip, and the message points at the field rather than at git's stderr.
  const pathError =
    modulePath.length === 0
      ? null
      : modulePath.startsWith('/') || /^[A-Za-z]:/.test(modulePath)
        ? 'Enter a path inside this repository, not an absolute one.'
        : modulePath.split(/[/\\]/).some((part) => part === '..')
          ? 'The path can’t step outside the repository.'
          : existingPaths.includes(modulePath)
            ? `“${modulePath}” is already a submodule of this repository.`
            : null;

  const branchError =
    branch.trim().length > 0 && !/^[A-Za-z0-9._/-]+$/.test(branch.trim())
      ? 'Enter a valid branch name.'
      : null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, busy]);

  const canSubmit =
    !busy && trimmedUrl.length > 0 && modulePath.length > 0 && !pathError && !branchError;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const options: SubmoduleAddOptions = {
      url: trimmedUrl,
      path: modulePath,
      branch: branch.trim() || undefined,
    };
    const result = await window.api.repo.submoduleAdd(repoPath, options);
    setBusy(false);
    if (result.status === 'ok') {
      onAdded();
      onClose();
    } else {
      setError(result.message);
    }
  };

  return (
    <div className="settings-overlay" onClick={() => (busy ? undefined : onClose())}>
      <div
        className="settings-panel worktree-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add a submodule"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>Add a submodule</h2>
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
          className="settings-content pr-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="pr-form-field">
            <span className="pr-form-label">Repository URL</span>
            <input
              value={url}
              placeholder="https://github.com/owner/repo.git"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>

          <label className="pr-form-field">
            <span className="pr-form-label">Path in this repository</span>
            <input
              value={location}
              placeholder={suggested}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => setLocation(event.target.value)}
            />
            {pathError ? (
              <span className="pr-form-hint worktree-hint-error">{pathError}</span>
            ) : (
              <span className="pr-form-hint">
                Where the submodule is checked out, relative to the repository root
                — e.g. “vendor/library”.
              </span>
            )}
          </label>

          <label className="pr-form-field">
            <span className="pr-form-label">Branch to track (optional)</span>
            <input
              value={branch}
              placeholder="main"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => setBranch(event.target.value)}
            />
            {branchError ? (
              <span className="pr-form-hint worktree-hint-error">{branchError}</span>
            ) : (
              <span className="pr-form-hint">
                Recorded in .gitmodules, so the submodule can later be updated to
                this branch’s tip.
              </span>
            )}
          </label>

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
              {busy ? 'Adding…' : 'Add submodule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
