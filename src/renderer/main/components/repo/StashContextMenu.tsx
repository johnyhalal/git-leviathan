import { useConfirm } from '../ConfirmBar';
import { ContextMenu } from './ContextMenu';

/** The stash a context menu was opened on. */
export interface StashMenuTarget {
  /** Stash index (`stash@{index}`); 0 is the most recent. */
  index: number;
  /** The stash's message, shown in the delete confirmation. */
  message: string;
}

interface StashContextMenuProps {
  /** The stash the menu acts on. */
  target: StashMenuTarget;
  /** Viewport coordinates to anchor the menu at (the right-click point). */
  x: number;
  y: number;
  /** Dismiss the menu (outside click, Escape, or after an item runs). */
  onClose: () => void;
  /** Apply the stash, keeping it in the list (`git stash apply`). */
  onApply: (index: number) => void;
  /** Apply & drop the stash (`git stash pop`). */
  onPop: (index: number) => void;
  /** Discard the stash (`git stash drop`). */
  onDrop: (index: number) => void;
}

/** One row in the menu. */
interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

/**
 * A small right-click menu anchored at (x, y) offering to apply, pop, or delete a
 * stash. Apply and pop run immediately; delete is destructive, so it raises the
 * shared confirm bar (over the toolbar) rather than dropping the stash outright.
 */
export function StashContextMenu({
  target,
  x,
  y,
  onClose,
  onApply,
  onPop,
  onDrop,
}: StashContextMenuProps) {
  const requestConfirm = useConfirm();

  const items: MenuItem[] = [
    {
      label: 'Apply stash',
      onClick: () => onApply(target.index),
    },
    {
      label: 'Pop stash',
      onClick: () => onPop(target.index),
    },
    {
      label: 'Delete stash',
      danger: true,
      onClick: () =>
        requestConfirm({
          message: `Delete stash “${target.message}”? This can’t be undone.`,
          cancelLabel: 'Cancel',
          actions: [
            {
              label: 'Delete',
              tone: 'danger',
              busyLabel: 'Deleting…',
              onClick: () => onDrop(target.index),
            },
          ],
        }),
    },
  ];

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={
            'context-menu-item' + (item.danger ? ' context-menu-item-danger' : '')
          }
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          {item.label}
        </button>
      ))}
    </ContextMenu>
  );
}
