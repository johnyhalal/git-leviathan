import type { RemoteInfo } from '../../../../types/ipc';
import { useConfirm } from '../ConfirmBar';
import { ContextMenu } from './ContextMenu';

interface RemoteContextMenuProps {
  /** The remote the menu acts on. */
  remote: RemoteInfo;
  /** Viewport coordinates to anchor the menu at. */
  x: number;
  y: number;
  /** Dismiss the menu (outside click, Escape, or after an item runs). */
  onClose: () => void;
  /** Open the edit popup for this remote. */
  onEdit: (remote: RemoteInfo) => void;
  /** Remove the remote (local only). */
  onRemove: (name: string) => Promise<unknown>;
}

/**
 * Menu for a remote's folder in the sidebar: edit its details in a popup, or
 * remove it. Removal only drops the local config and remote-tracking branches —
 * nothing on the server — but still goes through the shared confirm bar.
 */
export function RemoteContextMenu({ remote, x, y, onClose, onEdit, onRemove }: RemoteContextMenuProps) {
  const requestConfirm = useConfirm();

  const confirmRemove = () =>
    requestConfirm({
      message: `Remove the remote “${remote.name}”? Its remote branches disappear from this repository; nothing on the server is deleted.`,
      cancelLabel: 'Cancel',
      actions: [
        {
          label: 'Remove',
          tone: 'danger',
          busyLabel: 'Removing…',
          onClick: async () => {
            await onRemove(remote.name);
          },
        },
      ],
    });

  const items = [
    { label: 'Edit remote…', danger: false, onClick: () => onEdit(remote) },
    { label: 'Remove remote', danger: true, onClick: confirmRemove },
  ];

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={'context-menu-item' + (item.danger ? ' context-menu-item-danger' : '')}
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
