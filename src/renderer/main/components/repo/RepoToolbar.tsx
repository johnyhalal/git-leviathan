import { useState, type ReactNode } from 'react';
import type { PullMode, StashPushOptions } from '../../../../types/ipc';
import { PushIcon, PopIcon, BranchIcon, UndoIcon, RedoIcon, FolderCogIcon, SearchIcon, ExternalIcon } from '../../../../../assets/icons';
import { BranchSelect } from './BranchSelect';
import { PullAction } from './PullAction';
import { StashAction } from './StashAction';
import { useConfirm } from '../ConfirmBar';
import { useCommands } from '../../commands/CommandRegistry';
import { withShortcut } from '../../commands/keys';
import { FileContextMenu } from './FileContextMenu';
import { openMenuItems, useOpenTools } from '../../openActions';

interface RepoToolbarProps {
  /** The open repository, for the "Open in…" menu. */
  repoPath: string;
  /** The checked-out branch name (from the real repo). */
  branch: string;
  /** All local branch names, for the switcher dropdown. */
  branches: string[];
  /** Check out the chosen branch. */
  onCheckout: (branch: string) => void;
  /**
   * Push the current branch to its upstream. Resolves with the pending publish
   * target (remote + branch) when the branch has no upstream yet, so the toolbar
   * can confirm publishing it; null otherwise (pushed, or nothing to do).
   */
  onPush: () => Promise<{ remote: string; branch: string } | null>;
  /**
   * Publish a branch with no upstream to `remote`, setting it as the upstream.
   * `remoteBranch` is the name the branch should take on the remote (defaults to
   * the local `branch` name when left empty).
   */
  onPublishBranch: (remote: string, branch: string, remoteBranch: string) => Promise<void>;
  /** Whether a push is currently in flight (disables the button). */
  pushing: boolean;
  /** Pull/fetch the current branch using the chosen mode. */
  onPull: (mode: PullMode) => void;
  /** Whether a pull is currently in flight (disables the button). */
  pulling: boolean;
  /** Stash the working tree's uncommitted changes (`git stash push`). */
  onStash: (options?: StashPushOptions) => void;
  /** Whether there are uncommitted changes to stash (enables the Stash button). */
  canStash: boolean;
  /** Whether anything is staged (enables "stash staged changes only"). */
  hasStaged: boolean;
  /** Whether the repo has at least one stash (enables the Pop button). */
  hasStash: boolean;
  /** Apply & drop the latest stash (`git stash pop stash@{0}`). */
  onPop: () => void;
  /** Toggle the inline "new branch" input at the HEAD commit. */
  onBranch: () => void;
  /** Whether the inline "new branch" input is currently open. */
  branching: boolean;
  /** Undo the last HEAD-moving action (commit/checkout/merge/rebase/reset). */
  onUndo: () => void;
  /** Redo the last undone action. */
  onRedo: () => void;
  /** Label of the action the next undo would revert, or null when there's none. */
  undoLabel: string | null;
  /** Label of the action the next redo would re-apply, or null when there's none. */
  redoLabel: string | null;
  /** Open the per-repository settings dialog (commit identity, remotes). */
  onOpenRepoSettings: () => void;
  /** Whether the commit-search bar is open. */
  searchOpen: boolean;
  /** Open the commit-search bar, or close it when it's already open. */
  onToggleSearch: () => void;
  /** The commit-search bar, floated beside the magnifier while `searchOpen`. */
  searchBar: ReactNode;
}

/**
 * Repository-level top bar: current-branch selector on the left, sync actions
 * in the middle (label over icon). Pull, push, stash, pop and branch checkout
 * are all wired to git.
 */
export function RepoToolbar({
  repoPath,
  branch,
  branches,
  onCheckout,
  onPush,
  onPublishBranch,
  pushing,
  onPull,
  pulling,
  onStash,
  canStash,
  hasStaged,
  hasStash,
  onPop,
  onBranch,
  branching,
  onUndo,
  onRedo,
  undoLabel,
  redoLabel,
  onOpenRepoSettings,
  searchOpen,
  onToggleSearch,
  searchBar,
}: RepoToolbarProps) {
  const requestConfirm = useConfirm();

  // Push; if the branch has no upstream yet, raise a confirm bar over the toolbar
  // asking whether to publish it to the remote (creating the branch there) and
  // set it as the upstream. Confirming runs the publish; the bar handles the
  // busy/close cycle and stays open if the publish throws.
  const handlePush = async () => {
    const pending = await onPush();
    if (!pending) return;
    requestConfirm({
      message: `Publish “${pending.branch}” to ${pending.remote} as:`,
      cancelLabel: 'Cancel',
      input: {
        placeholder: pending.branch,
        ariaLabel: 'Remote branch name',
      },
      actions: [
        {
          label: `Publish to ${pending.remote}`,
          tone: 'primary',
          busyLabel: 'Publishing…',
          onClick: (remoteBranch) =>
            onPublishBranch(pending.remote, pending.branch, remoteBranch.trim() || pending.branch),
        },
      ],
    });
  };

  // Registered here, not in RepoView, so a menu or palette push on a branch with
  // no upstream raises the same publish confirm as the button.
  useCommands([{ id: 'repo.push', run: () => void handlePush(), enabled: !pushing }]);

  // "Open in…": the repo folder in the editor, a terminal or the file manager.
  const editorName = useOpenTools()?.editorName;
  const [openMenu, setOpenMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <div className="repo-toolbar">
      <div className="repo-toolbar-left">
        <BranchSelect branch={branch} branches={branches} onSelect={onCheckout} />
      </div>

      <div className="repo-toolbar-center">
        <button
          type="button"
          className={`repo-action tooltip-host${undoLabel ? '' : ' is-disabled'}`}
          data-tooltip={withShortcut(undoLabel ? `Undo ${undoLabel}` : 'Nothing to undo', 'repo.undo')}
          aria-label={undoLabel ? `Undo ${undoLabel}` : 'Nothing to undo'}
          onClick={() => undoLabel && onUndo()}
          aria-disabled={!undoLabel}
        >
          <span className="repo-action-label">Undo</span>
          <UndoIcon size={18} />
        </button>
        <button
          type="button"
          className={`repo-action tooltip-host${redoLabel ? '' : ' is-disabled'}`}
          data-tooltip={withShortcut(redoLabel ? `Redo ${redoLabel}` : 'Nothing to redo', 'repo.redo')}
          aria-label={redoLabel ? `Redo ${redoLabel}` : 'Nothing to redo'}
          onClick={() => redoLabel && onRedo()}
          aria-disabled={!redoLabel}
        >
          <span className="repo-action-label">Redo</span>
          <RedoIcon size={18} />
        </button>
        <PullAction onPull={onPull} pulling={pulling} />
        <button
          type="button"
          className="repo-action tooltip-host"
          data-tooltip={withShortcut('Push commits to the remote', 'repo.push')}
          onClick={() => void handlePush()}
          disabled={pushing}
        >
          <span className="repo-action-label">{pushing ? 'Pushing…' : 'Push'}</span>
          <PushIcon size={18} />
        </button>
        <button
            type="button"
            className={`repo-action tooltip-host${branching ? ' is-active' : ''}`}
            data-tooltip={withShortcut('Create a branch at the current commit', 'repo.branch')}
            onClick={onBranch}
            aria-pressed={branching}
        >
          <span className="repo-action-label">Branch</span>
          <BranchIcon size={18} />
        </button>
        <StashAction onStash={onStash} canStash={canStash} hasStaged={hasStaged} branch={branch} />
        <button
          type="button"
          className={`repo-action tooltip-host${hasStash ? '' : ' is-disabled'}`}
          data-tooltip={hasStash ? 'Pop the latest stash' : 'No stash to pop'}
          onClick={() => hasStash && onPop()}
          aria-disabled={!hasStash}
        >
          <span className="repo-action-label">Pop</span>
          <PopIcon size={18} />
        </button>
      </div>

      <div className="repo-toolbar-right">
        {searchOpen && searchBar}
        <button
          type="button"
          className={`repo-settings-button tooltip-host${searchOpen ? ' is-active' : ''}`}
          data-tooltip={withShortcut('Search commits', 'repo.search')}
          aria-label="Search commits"
          aria-pressed={searchOpen}
          onClick={onToggleSearch}
        >
          <SearchIcon size={20} />
        </button>
        <button
          type="button"
          className={`repo-settings-button tooltip-host${openMenu ? ' is-active' : ''}`}
          data-tooltip="Open in…"
          aria-label="Open repository in…"
          aria-haspopup="menu"
          aria-expanded={openMenu !== null}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setOpenMenu({ x: rect.left, y: rect.bottom + 4 });
          }}
        >
          <ExternalIcon size={18} />
        </button>
        {openMenu && (
          <FileContextMenu
            x={openMenu.x}
            y={openMenu.y}
            onClose={() => setOpenMenu(null)}
            items={openMenuItems(editorName, repoPath)}
          />
        )}
        <button
          type="button"
          className="repo-settings-button tooltip-host"
          data-tooltip="Repository settings"
          aria-label="Repository settings"
          onClick={onOpenRepoSettings}
        >
          <FolderCogIcon size={22} />
        </button>
      </div>
    </div>
  );
}
