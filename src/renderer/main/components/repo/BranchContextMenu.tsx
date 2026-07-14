import { useConfirm } from '../ConfirmBar';
import { ContextMenu } from './ContextMenu';

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
   * The branches to offer actions for. Opening the menu on a single badge passes
   * one; opening it on a commit row passes every branch sitting on that commit, so
   * each of their actions is listed together (grouped, separated per branch).
   */
  targets: BranchMenuTarget[];
  /** Viewport coordinates to anchor the menu at (the right-click point). */
  x: number;
  y: number;
  /**
   * The checked-out branch, or undefined on a detached HEAD. Merge/rebase are
   * expressed relative to it, so they only appear when it exists and differs from
   * the target.
   */
  currentBranch?: string;
  /** Dismiss the menu (outside click, Escape, or after an item runs). */
  onClose: () => void;
  /** Check out a branch (`remote` set for a remote-only branch, to track it). */
  onCheckout: (name: string, remote?: string) => void;
  /** Merge `source` into `target` (used here to merge a branch into the current one). */
  onMerge: (source: string, target: string) => void;
  /** Rebase `target` onto `source` (used here to rebase the current branch onto one). */
  onRebase: (source: string, target: string) => void;
  /** Rename the local branch `oldName` to `newName` (`git branch -m`). */
  onRenameBranch: (oldName: string, newName: string) => void;
  /** Delete the local branch of this name (`git branch -D`). */
  onDeleteBranch: (name: string) => void;
  /** Delete this branch on its remote (`git push <remote> --delete`). */
  onDeleteRemoteBranch: (remote: string, name: string) => void;
}

/** One row in the menu. */
interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

/** A menu row or a divider between action groups. */
type MenuEntry = MenuItem | 'separator';

type Handlers = Pick<
  BranchContextMenuProps,
  'onCheckout' | 'onMerge' | 'onRebase' | 'onRenameBranch' | 'onDeleteBranch' | 'onDeleteRemoteBranch'
>;

/**
 * Build the actions available for one branch: checkout, merge/rebase relative to
 * the checked-out branch, rename, and delete (local / remote). The destructive
 * delete rows are separated from the rest, and each delete — plus rename, which
 * needs a name — routes through the shared confirm bar rather than acting at once.
 */
function targetEntries(
  target: BranchMenuTarget,
  currentBranch: string | undefined,
  requestConfirm: ReturnType<typeof useConfirm>,
  h: Handlers,
): MenuEntry[] {
  const actions: MenuItem[] = [];
  const dangers: MenuItem[] = [];

  // Checkout — switch to this branch, tracking the remote one when it's remote-only.
  if (target.local && !target.isCurrent) {
    actions.push({ label: `Checkout ${target.name}`, onClick: () => h.onCheckout(target.name) });
  } else if (!target.local && target.remote && target.remoteName) {
    const remote = target.remoteName;
    actions.push({ label: `Checkout ${target.name}`, onClick: () => h.onCheckout(target.name, remote) });
  }

  // Merge / rebase are expressed relative to the checked-out branch, so they need
  // one that differs from this (local) target.
  if (currentBranch && target.local && target.name !== currentBranch) {
    actions.push({
      label: `Merge into ${currentBranch}`,
      onClick: () => h.onMerge(target.name, currentBranch),
    });
    actions.push({
      label: `Rebase ${currentBranch} onto ${target.name}`,
      onClick: () => h.onRebase(target.name, currentBranch),
    });
  }

  // Rename — local branches only (the checked-out one included). The new name is
  // collected in the confirm bar's inline field.
  if (target.local) {
    actions.push({
      label: `Rename ${target.name}…`,
      onClick: () =>
        requestConfirm({
          message: `Rename branch “${target.name}” to:`,
          cancelLabel: 'Cancel',
          input: {
            defaultValue: target.name,
            ariaLabel: 'New branch name',
            placeholder: 'branch-name',
          },
          actions: [
            {
              label: 'Rename',
              tone: 'primary',
              busyLabel: 'Renaming…',
              onClick: (value) => {
                const next = value.trim();
                if (next && next !== target.name) h.onRenameBranch(target.name, next);
              },
            },
          ],
        }),
    });
  }

  // Delete — destructive, so each first raises the confirm bar.
  if (target.local && !target.isCurrent) {
    dangers.push({
      label: `Delete ${target.name}`,
      danger: true,
      onClick: () =>
        requestConfirm({
          message: `Delete local branch “${target.name}”? This can’t be undone.`,
          cancelLabel: 'Cancel',
          actions: [
            {
              label: 'Delete',
              tone: 'danger',
              busyLabel: 'Deleting…',
              onClick: () => h.onDeleteBranch(target.name),
            },
          ],
        }),
    });
  }
  if (target.remote && target.remoteName) {
    const remote = target.remoteName;
    dangers.push({
      label: `Delete ${remote}/${target.name}`,
      danger: true,
      onClick: () =>
        requestConfirm({
          message: `Delete “${remote}/${target.name}” from the remote? This can’t be undone.`,
          cancelLabel: 'Cancel',
          actions: [
            {
              label: 'Delete',
              tone: 'danger',
              busyLabel: 'Deleting…',
              onClick: () => h.onDeleteRemoteBranch(remote, target.name),
            },
          ],
        }),
    });
  }

  const entries: MenuEntry[] = [...actions];
  if (actions.length && dangers.length) entries.push('separator');
  entries.push(...dangers);
  return entries;
}

/**
 * A right-click menu anchored at (x, y) offering per-branch actions: checkout,
 * merge/rebase relative to the checked-out branch, rename, and delete (locally
 * and/or on its remote). Confirmation and name entry are delegated to the shared
 * confirm bar. Renders nothing when no target has an available action.
 */
export function BranchContextMenu({
  targets,
  x,
  y,
  currentBranch,
  onClose,
  onCheckout,
  onMerge,
  onRebase,
  onRenameBranch,
  onDeleteBranch,
  onDeleteRemoteBranch,
}: BranchContextMenuProps) {
  const requestConfirm = useConfirm();
  const handlers: Handlers = {
    onCheckout,
    onMerge,
    onRebase,
    onRenameBranch,
    onDeleteBranch,
    onDeleteRemoteBranch,
  };

  // Flatten every target's entries, dividing one branch's group from the next.
  const entries: MenuEntry[] = [];
  for (const target of targets) {
    const group = targetEntries(target, currentBranch, requestConfirm, handlers);
    if (group.length === 0) continue;
    if (entries.length) entries.push('separator');
    entries.push(...group);
  }
  if (entries.length === 0) return null;

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {entries.map((entry, index) =>
        entry === 'separator' ? (
          <div key={`sep-${index}`} className="context-menu-sep" role="separator" />
        ) : (
          <button
            key={`${entry.label}-${index}`}
            type="button"
            role="menuitem"
            className={'context-menu-item' + (entry.danger ? ' context-menu-item-danger' : '')}
            onClick={() => {
              onClose();
              entry.onClick();
            }}
          >
            {entry.label}
          </button>
        ),
      )}
    </ContextMenu>
  );
}
