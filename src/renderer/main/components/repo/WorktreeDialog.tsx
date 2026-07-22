import { useEffect, useMemo, useState } from 'react';
import { CloseIcon, FolderIcon } from '../../../../../assets/icons';
import type { WorktreeAddOptions } from '../../../../types/ipc';
import { WorktreeBranchSelect } from './WorktreeBranchSelect';

/** One branch offered in the "Check out" select. */
export interface WorktreeBranchOption {
  /** The ref to base the worktree on, e.g. "dev" (local) or "origin/dev" (remote). */
  ref: string;
  /** Whether this is a remote-tracking branch. */
  remote: boolean;
  /** Default local branch name for this ref ("dev" for both "dev" and "origin/dev"). */
  name: string;
}

interface WorktreeDialogProps {
  /** The repository the worktree is added to (drives defaults + the API call). */
  repoPath: string;
  /** Every local and remote branch, listed distinctly (dev, main, origin/dev, …). */
  branches: WorktreeBranchOption[];
  /** Branches already checked out in a worktree — can't be checked out again. */
  occupiedBranches: string[];
  /** Dismiss the dialog. */
  onClose: () => void;
  /** A worktree was created: refs should reload. */
  onCreated: () => void;
  /** Open the created worktree's folder as a repository in a new tab. */
  onOpen: (path: string) => void;
}

/** The platform path separator, inferred from the repo path. */
function separatorOf(p: string): string {
  return p.includes('\\') && !p.includes('/') ? '\\' : '/';
}

/** Strip a trailing path separator, so a suffix can be appended cleanly. */
function trimTrailingSep(p: string): string {
  return p.replace(/[/\\]+$/, '');
}

/**
 * Modal form for adding a worktree. Mirrors the Settings/new-PR dialog shell.
 * Pick the branch (or remote branch) to check out; the always-visible branch-name
 * field defaults to that branch's name but can be overwritten to fork a new branch
 * off it instead. Choose the location on disk (a sibling folder is suggested from
 * the branch name, editable or replaceable via Browse), and optionally open the
 * result in a new tab. The call goes through `repo.worktreeAdd`.
 */
export function WorktreeDialog({
  repoPath,
  branches,
  occupiedBranches,
  onClose,
  onCreated,
  onOpen,
}: WorktreeDialogProps) {
  const sep = useMemo(() => separatorOf(repoPath), [repoPath]);

  // No branch is preselected — the checkout dropdown opens on its placeholder so
  // the user makes a deliberate choice.
  const [checkout, setCheckout] = useState('');
  // The branch name to check out / create. Empty means "use the default" (the
  // placeholder), so picking a different checkout retargets it until the user types.
  const [name, setName] = useState('');
  // The typed location; empty means "use the suggested path" (the placeholder).
  const [location, setLocation] = useState('');
  const [openAfter, setOpenAfter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The default branch name for the selected checkout (its bare name).
  const defaultName = branches.find((option) => option.ref === checkout)?.name ?? '';
  // What we'll actually create: the typed name, or the default when left blank.
  const branch = name.trim() || defaultName;

  // The worktree always gets a fresh branch forked from the selected base, so the
  // name must be free — not already a local branch (git would refuse to create it,
  // or silently reuse it), and not one already checked out in another worktree.
  // The base's own name is offered as the default, so a local base needs renaming.
  const branchError =
    branch.length === 0
      ? null
      : occupiedBranches.includes(branch)
        ? `“${branch}” is already checked out in another worktree — enter a new branch name.`
        : branches.some((option) => !option.remote && option.name === branch)
          ? `A local branch named “${branch}” already exists — enter a different name.`
          : null;

  // Suggested location: a "<repo>.worktrees" sibling folder, one subfolder per
  // branch — e.g. "/repos/app" → "/repos/app.worktrees/origin-dev". Empty until a
  // branch is chosen, so the field starts blank rather than showing a stub path.
  const suggested = useMemo(
    () => (branch ? `${trimTrailingSep(repoPath)}.worktrees${sep}${branch}` : ''),
    [repoPath, sep, branch],
  );

  // What we'll actually create at: the typed path, or the suggested one when blank.
  const targetPath = location.trim() || suggested;

  // Soft advisory: a worktree nested inside any git working tree pollutes that
  // repo's status unless the folder is gitignored. Asked of the main process (git
  // is authoritative) whenever the target path changes. The default sibling
  // ".worktrees" location isn't inside a checkout, so it stays silent there.
  const [locationInsideRepo, setLocationInsideRepo] = useState(false);
  useEffect(() => {
    if (!targetPath) {
      setLocationInsideRepo(false);
      return;
    }
    let live = true;
    void window.api.repo.pathInsideWorktree(targetPath).then((inside) => {
      if (live) setLocationInsideRepo(inside);
    });
    return () => {
      live = false;
    };
  }, [targetPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, busy]);

  const browse = async () => {
    const dir = await window.api.repo.chooseDirectory();
    if (!dir) return;
    // The picker returns a folder to hold the worktree; append the branch name so
    // the target is a fresh subfolder rather than the (existing) picked one, which
    // git would refuse.
    setLocation(`${trimTrailingSep(dir)}${separatorOf(dir)}${branch || 'worktree'}`);
  };

  const canSubmit =
    !busy &&
    targetPath.length > 0 &&
    branch.length > 0 &&
    checkout.length > 0 &&
    !branchError;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const options: WorktreeAddOptions = {
      path: targetPath,
      branch,
      startPoint: checkout,
    };
    const result = await window.api.repo.worktreeAdd(repoPath, options);
    setBusy(false);
    if (result.status === 'ok') {
      onCreated();
      if (openAfter) onOpen(targetPath);
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
        aria-label="Add a worktree"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>Add a worktree</h2>
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
          <div className="pr-form-field">
            <span className="pr-form-label">Check out</span>
            <WorktreeBranchSelect
              value={checkout}
              options={branches}
              placeholder="Select a branch…"
              onChange={setCheckout}
            />
          </div>

          <label className="pr-form-field">
            <span className="pr-form-label">Branch name</span>
            <input
              value={name}
              placeholder={defaultName}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => setName(event.target.value)}
            />
            {branchError ? (
              <span className="pr-form-hint worktree-hint-error">{branchError}</span>
            ) : (
              <span className="pr-form-hint">
                A new branch with this name is created from the selected one — it
                can’t match an existing branch.
              </span>
            )}
          </label>

          <label className="pr-form-field">
            <span className="pr-form-label">Location</span>
            <span className="worktree-location-row">
              <input
                className="worktree-location-input"
                value={location}
                placeholder={suggested}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => setLocation(event.target.value)}
              />
              <button
                type="button"
                className="pill-btn pill-btn-gray worktree-browse"
                onClick={() => void browse()}
                disabled={busy}
              >
                <FolderIcon size={14} />
                Browse…
              </button>
            </span>
          </label>

          <label className="pr-form-check">
            <input
              type="checkbox"
              checked={openAfter}
              onChange={(event) => setOpenAfter(event.target.checked)}
            />
            <span>Open in a new tab after creating</span>
          </label>

          {locationInsideRepo && (
              <span className="pr-form-hint worktree-hint-warn">
                Not recommended: this is inside the repository’s working directory.
                Make sure its folder is ignored in .gitignore.
              </span>
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
              {busy ? 'Creating…' : 'Add worktree'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
