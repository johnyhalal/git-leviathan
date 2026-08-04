import { useConfirm } from '../ConfirmBar';
import { ContextMenu } from './ContextMenu';

/** The tag a context menu was opened on. */
export interface TagMenuTarget {
  /** Tag name. */
  name: string;
}

interface TagContextMenuProps {
  /** The tag the menu acts on. */
  target: TagMenuTarget;
  /** Viewport coordinates to anchor the menu at (the right-click point). */
  x: number;
  y: number;
  /**
   * The remote the push / delete-on-remote actions target (`origin`, or the sole
   * remote). Undefined when the repo has no remote, or several without an
   * `origin` — the remote-facing actions are then hidden.
   */
  remote?: string;
  /**
   * Whether this tag is already on `remote`: `false` shows only "Push", `true`
   * shows only "Delete on remote", `null` (couldn't be determined) shows both.
   */
  pushed?: boolean | null;
  /** Dismiss the menu (outside click, Escape, or after an item runs). */
  onClose: () => void;
  /** Re-create the tag as annotated with the entered message. */
  onAnnotate: (name: string, message: string) => void;
  /** Push this tag to `remote` (`git push <remote> refs/tags/<name>`). */
  onPush: (name: string, remote: string) => void;
  /** Delete this tag on `remote` (after confirmation). */
  onDeleteRemote: (name: string, remote: string) => void;
  /** Delete this tag locally (`git tag -d`, after confirmation). */
  onDeleteLocal: (name: string) => void;
}

/** One row in the menu. */
interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

/** A menu row or a divider between action groups. */
type MenuEntry = MenuItem | 'separator';

/**
 * A right-click menu for a tag row: annotate the tag (re-create it as annotated
 * via the confirm bar), and — when a remote resolves — push the tag to that
 * remote or delete it there. A normal `git push` never carries tags, so pushing
 * one is an explicit action here. Delete-on-remote is destructive, so it raises
 * the shared confirm bar first.
 */
export function TagContextMenu({
  target,
  x,
  y,
  remote,
  pushed,
  onClose,
  onAnnotate,
  onPush,
  onDeleteRemote,
  onDeleteLocal,
}: TagContextMenuProps) {
  const requestConfirm = useConfirm();

  const entries: MenuEntry[] = [
    {
      label: `Annotate ${target.name}`,
      onClick: () =>
        requestConfirm({
          message: `Annotate tag “${target.name}” with a message:`,
          cancelLabel: 'Cancel',
          input: { ariaLabel: 'Tag message', placeholder: 'tag message' },
          actions: [
            {
              label: 'Annotate',
              tone: 'primary',
              busyLabel: 'Annotating…',
              onClick: (value) => {
                const message = value.trim();
                // Keep the bar open (throw) when empty — an annotated tag needs one.
                if (!message) throw new Error('A tag message is required.');
                onAnnotate(target.name, message);
              },
            },
          ],
        }),
    },
  ];

  // Remote actions (only when a remote resolves): push when the tag isn't already
  // there, delete-on-remote when it is; when the pushed state is unknown (null),
  // offer both.
  const remoteActions: MenuItem[] = [];
  if (remote) {
    if (pushed !== true) {
      remoteActions.push({
        label: `Push ${target.name} to ${remote}`,
        onClick: () => onPush(target.name, remote),
      });
    }
    if (pushed !== false) {
      remoteActions.push({
        label: `Delete ${target.name} from ${remote}`,
        danger: true,
        onClick: () =>
          requestConfirm({
            message: `Delete tag “${target.name}” from “${remote}”? The local tag is kept.`,
            cancelLabel: 'Cancel',
            actions: [
              {
                label: 'Delete',
                tone: 'danger',
                busyLabel: 'Deleting…',
                onClick: () => onDeleteRemote(target.name, remote),
              },
            ],
          }),
      });
    }
  }

  // Local deletion is always available — a local tag can be removed regardless of
  // whether it also lives on the remote (deleting it there is the separate action
  // above, which keeps the local copy).
  const localDelete: MenuItem = {
    label: `Delete ${target.name} locally`,
    danger: true,
    onClick: () =>
      requestConfirm({
        message: `Delete tag “${target.name}” locally? This can’t be undone.`,
        cancelLabel: 'Cancel',
        actions: [
          {
            label: 'Delete',
            tone: 'danger',
            busyLabel: 'Deleting…',
            onClick: () => onDeleteLocal(target.name),
          },
        ],
      }),
  };

  entries.push('separator');
  entries.push(...remoteActions);
  entries.push(localDelete);

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
