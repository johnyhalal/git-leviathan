import type { PullMode } from '../../../../types/ipc';
import { PushIcon, StashIcon, PopIcon } from '../../../../../assets/icons';
import { BranchSelect } from './BranchSelect';
import { PullAction } from './PullAction';

interface RepoToolbarProps {
  /** The checked-out branch name (from the real repo). */
  branch: string;
  /** All local branch names, for the switcher dropdown. */
  branches: string[];
  /** Check out the chosen branch. */
  onCheckout: (branch: string) => void;
  /** Push the current branch to its upstream. */
  onPush: () => void;
  /** Whether a push is currently in flight (disables the button). */
  pushing: boolean;
  /** Pull/fetch the current branch using the chosen mode. */
  onPull: (mode: PullMode) => void;
  /** Whether a pull is currently in flight (disables the button). */
  pulling: boolean;
  /** Stash the working tree's uncommitted changes (`git stash push`). */
  onStash: () => void;
  /** Whether there are uncommitted changes to stash (enables the Stash button). */
  canStash: boolean;
  /** Whether the repo has at least one stash (enables the Pop button). */
  hasStash: boolean;
  /** Apply & drop the latest stash (`git stash pop stash@{0}`). */
  onPop: () => void;
}

/**
 * Repository-level top bar: current-branch selector on the left, sync actions
 * in the middle (label over icon). Pull, push, stash, pop and branch checkout
 * are all wired to git.
 */
export function RepoToolbar({
  branch,
  branches,
  onCheckout,
  onPush,
  pushing,
  onPull,
  pulling,
  onStash,
  canStash,
  hasStash,
  onPop,
}: RepoToolbarProps) {
  return (
    <div className="repo-toolbar">
      <div className="repo-toolbar-left">
        <BranchSelect branch={branch} branches={branches} onSelect={onCheckout} />
      </div>

      <div className="repo-toolbar-center">
        <PullAction onPull={onPull} pulling={pulling} />
        <button
          type="button"
          className="repo-action tooltip-host"
          data-tooltip="Push commits to the remote"
          onClick={onPush}
          disabled={pushing}
        >
          <span className="repo-action-label">{pushing ? 'Pushing…' : 'Push'}</span>
          <PushIcon size={18} />
        </button>
        <button
          type="button"
          className={`repo-action tooltip-host${canStash ? '' : ' is-disabled'}`}
          data-tooltip={canStash ? 'Stash your uncommitted changes' : 'No changes to stash'}
          onClick={() => canStash && onStash()}
          aria-disabled={!canStash}
        >
          <span className="repo-action-label">Stash</span>
          <StashIcon size={18} />
        </button>
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

      <div className="repo-toolbar-right" />
    </div>
  );
}
