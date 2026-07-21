import { useConfirm } from '../ConfirmBar';
import { ContextMenu } from './ContextMenu';

/** The worktree a context menu was opened on. */
export interface WorktreeMenuTarget {
  /** Absolute path of the worktree's directory. */
  path: string;
  /** The branch checked out there, for the labels/confirmation. */
  branch?: string;
  /** True for the primary worktree, which can't be removed or locked. */
  isMain: boolean;
  /** True when this is the worktree already open in this tab. */
  isCurrent: boolean;
  /** True when git reports the worktree as locked (drives lock vs unlock). */
  locked: boolean;
}

interface WorktreeContextMenuProps {
  /** The worktree the menu acts on. */
  target: WorktreeMenuTarget;
  /** Viewport coordinates to anchor the menu at (the right-click point). */
  x: number;
  y: number;
  /** Dismiss the menu (outside click, Escape, or after an item runs). */
  onClose: () => void;
  /** Open the worktree's folder as a repository in the current tab. */
  onOpenHere: (path: string) => void;
  /** Open the worktree's folder as a repository in a new tab. */
  onOpenInNewTab: (path: string) => void;
  /** Remove the worktree; `force` when it's dirty, `deleteBranch` to drop its branch. */
  onRemove: (path: string, force: boolean, deleteBranch: boolean) => void;
  /** Lock (`lock: true`) or unlock the worktree. */
  onLock: (path: string, lock: boolean) => void;
}

/** One actionable row in the menu. */
interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

type MenuEntry = MenuItem | 'separator';

/**
 * Right-click menu for a worktree row. The open actions only appear for a
 * worktree other than the one already open here; the remove/lock actions only
 * appear for created (linked) worktrees, never the main one. Removals are
 * destructive, so they raise the shared confirm bar rather than acting outright.
 */
export function WorktreeContextMenu({
  target,
  x,
  y,
  onClose,
  onOpenHere,
  onOpenInNewTab,
  onRemove,
  onLock,
}: WorktreeContextMenuProps) {
  const requestConfirm = useConfirm();
  const label = target.branch ?? target.path;

  const entries: MenuEntry[] = [];

  // Open actions — not for the worktree already open in this tab.
  if (!target.isCurrent) {
    entries.push(
      { label: 'Open this worktree', onClick: () => onOpenHere(target.path) },
      { label: 'Open worktree in new tab', onClick: () => onOpenInNewTab(target.path) },
    );
  }

  // Remove/lock actions — only for created (linked) worktrees, never the main one.
  if (!target.isMain) {
    entries.push({
      label: 'Remove this worktree',
      danger: true,
      onClick: () =>
        requestConfirm({
          message: `Remove the worktree for “${label}”? Its folder is deleted; the branch is kept.`,
          cancelLabel: 'Cancel',
          actions: [
            {
              label: 'Remove',
              tone: 'danger',
              busyLabel: 'Removing…',
              onClick: () => onRemove(target.path, false, false),
            },
            {
              label: 'Force remove',
              tone: 'danger',
              busyLabel: 'Removing…',
              onClick: () => onRemove(target.path, true, false),
            },
          ],
        }),
    });

    // Deleting the branch only makes sense when the worktree has one.
    if (target.branch) {
      entries.push({
        label: 'Remove worktree and delete branch',
        danger: true,
        onClick: () =>
          requestConfirm({
            message: `Remove the worktree for “${label}” and delete the branch “${target.branch}”? This can’t be undone.`,
            cancelLabel: 'Cancel',
            actions: [
              {
                label: 'Remove & delete',
                tone: 'danger',
                busyLabel: 'Removing…',
                onClick: () => onRemove(target.path, false, true),
              },
              {
                label: 'Force',
                tone: 'danger',
                busyLabel: 'Removing…',
                onClick: () => onRemove(target.path, true, true),
              },
            ],
          }),
      });
    }

    entries.push('separator');
    entries.push({
      label: target.locked ? 'Unlock this worktree' : 'Lock this worktree',
      onClick: () => onLock(target.path, !target.locked),
    });
  }

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {entries.map((entry, index) =>
        entry === 'separator' ? (
          <div key={`sep-${index}`} className="context-menu-sep" role="separator" />
        ) : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            className={
              'context-menu-item' + (entry.danger ? ' context-menu-item-danger' : '')
            }
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
