import { useConfirm } from '../ConfirmBar';
import { useOutsideDismiss } from './useOutsideDismiss';

/** The branch a context menu was opened on, with enough state to pick its actions. */
export interface BranchMenuTarget {
  /** Branch basename, e.g. `main` (never the `origin/` prefix). */
  name: string;
  /** A local branch of this name exists. */
  local: boolean;
  /** Whether that local branch is the checked-out one (which git can't delete). */
  isCurrent: boolean;
  /** A remote-tracking branch of this name exists. */
  remote: boolean;
  /** The remote it lives on (`origin`, …), when `remote`. */
  remoteName?: string;
}

interface BranchContextMenuProps {
  /**
   * The branches to offer delete actions for. Opening the menu on a single badge
   * passes one; opening it on a commit row passes every branch sitting on that
   * commit, so each of their delete actions is listed together.
   */
  targets: BranchMenuTarget[];
  /** Viewport coordinates to anchor the menu at (the right-click point). */
  x: number;
  y: number;
  /** Dismiss the menu (outside click, Escape, or after an item runs). */
  onClose: () => void;
  /** Delete the local branch of this name (`git branch -D`). */
  onDeleteBranch: (name: string) => void;
  /** Delete this branch on its remote (`git push <remote> --delete`). */
  onDeleteRemoteBranch: (remote: string, name: string) => void;
}

/** One row in the menu. */
interface MenuItem {
  label: string;
  onClick: () => void;
}

/**
 * Build the delete actions available across `targets`: a local branch that isn't
 * the checked-out one can be deleted locally; a branch that exists on a remote can
 * be deleted there. Each action first raises the shared confirm bar (via
 * `requestConfirm`) so the destructive step is always confirmed.
 */
function deleteItems(
  targets: BranchMenuTarget[],
  requestConfirm: ReturnType<typeof useConfirm>,
  onDeleteBranch: (name: string) => void,
  onDeleteRemoteBranch: (remote: string, name: string) => void,
): MenuItem[] {
  const items: MenuItem[] = [];

  for (const target of targets) {
    if (target.local && !target.isCurrent) {
      items.push({
        label: `Delete ${target.name}`,
        onClick: () =>
          requestConfirm({
            message: `Delete local branch “${target.name}”? This can’t be undone.`,
            cancelLabel: 'Cancel',
            actions: [
              {
                label: 'Delete',
                tone: 'danger',
                busyLabel: 'Deleting…',
                onClick: () => onDeleteBranch(target.name),
              },
            ],
          }),
      });
    }

    if (target.remote && target.remoteName) {
      const remote = target.remoteName;
      items.push({
        label: `Delete ${remote}/${target.name}`,
        onClick: () =>
          requestConfirm({
            message: `Delete “${remote}/${target.name}” from the remote? This can’t be undone.`,
            cancelLabel: 'Cancel',
            actions: [
              {
                label: 'Delete',
                tone: 'danger',
                busyLabel: 'Deleting…',
                onClick: () => onDeleteRemoteBranch(remote, target.name),
              },
            ],
          }),
      });
    }
  }

  return items;
}

/**
 * A small right-click menu anchored at (x, y) offering to delete a branch locally
 * and/or on its remote. Confirmation is delegated to the shared confirm bar, so a
 * click here opens that bar rather than deleting immediately. Renders nothing when
 * the branch has no available delete action (e.g. only the checked-out branch).
 */
export function BranchContextMenu({
  targets,
  x,
  y,
  onClose,
  onDeleteBranch,
  onDeleteRemoteBranch,
}: BranchContextMenuProps) {
  const requestConfirm = useConfirm();
  const ref = useOutsideDismiss<HTMLDivElement>(true, onClose);

  const items = deleteItems(targets, requestConfirm, onDeleteBranch, onDeleteRemoteBranch);
  if (items.length === 0) return null;

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: x, top: y }}
      // Keep the right-click that opened us from also opening the native menu here.
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="context-menu-item context-menu-item-danger"
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
