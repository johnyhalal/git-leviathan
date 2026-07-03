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
}

/**
 * Repository-level top bar: current-branch selector on the left, sync actions
 * in the middle (label over icon). The pull/push/stash/pop actions are inert
 * for now; picking a branch triggers a real checkout.
 */
export function RepoToolbar({ branch, branches, onCheckout }: RepoToolbarProps) {
  return (
    <div className="repo-toolbar">
      <div className="repo-toolbar-left">
        <BranchSelect branch={branch} branches={branches} onSelect={onCheckout} />
      </div>

      <div className="repo-toolbar-center">
        <PullAction />
        <button
          type="button"
          className="repo-action tooltip-host"
          data-tooltip="Push commits to the remote"
        >
          <span className="repo-action-label">Push</span>
          <PushIcon size={18} />
        </button>
        <button
          type="button"
          className="repo-action tooltip-host"
          data-tooltip="Stash your uncommitted changes"
        >
          <span className="repo-action-label">Stash</span>
          <StashIcon size={18} />
        </button>
        <button
          type="button"
          className="repo-action tooltip-host"
          data-tooltip="Pop the latest stash"
        >
          <span className="repo-action-label">Pop</span>
          <PopIcon size={18} />
        </button>
      </div>

      <div className="repo-toolbar-right" />
    </div>
  );
}
