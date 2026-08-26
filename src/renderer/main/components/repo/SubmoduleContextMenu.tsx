import { useConfirm } from '../ConfirmBar';
import { ContextMenu } from './ContextMenu';
import type { SubmoduleState } from '../../../../types/ipc';

/** The submodule a context menu was opened on. */
export interface SubmoduleMenuTarget {
  /** The submodule's path, relative to the superproject's root. */
  path: string;
  /** Absolute path of its working directory, for opening it as a repository. */
  absolutePath: string;
  /** Its checkout state, which decides which actions make sense. */
  state: SubmoduleState;
  /** The branch recorded in `.gitmodules`, when it tracks one. */
  branch?: string;
}

/** Result of a deinit attempt, so a dirty refusal can prompt for force. */
export type SubmoduleDeinitOutcome = 'ok' | 'needs-force' | 'error';

interface SubmoduleContextMenuProps {
  /** The submodule the menu acts on. */
  target: SubmoduleMenuTarget;
  /** Viewport coordinates to anchor the menu at (the right-click point). */
  x: number;
  y: number;
  /** Dismiss the menu (outside click, Escape, or after an item runs). */
  onClose: () => void;
  /** Open the submodule's folder as a repository in a new tab. */
  onOpenInNewTab: (path: string) => void;
  /** Initialize and check the submodule out (`git submodule update --init`). */
  onInit: (path: string) => void;
  /** Check it out at the commit the superproject records. */
  onUpdate: (path: string) => void;
  /** Move it to its upstream branch tip (`git submodule update --remote`). */
  onUpdateRemote: (path: string) => void;
  /** Re-apply the URL from `.gitmodules` to its own config. */
  onSync: (path: string) => void;
  /**
   * Empty its working directory. Resolves `'needs-force'` when git refused
   * because of local modifications (so the caller can offer to force), `'ok'` on
   * success, or `'error'` when it failed for another (already-surfaced) reason.
   */
  onDeinit: (path: string, force: boolean) => Promise<SubmoduleDeinitOutcome>;
  /** Remove it entirely — folder, `.gitmodules` entry and internal clone. */
  onRemove: (path: string) => void;
}

/** One actionable row in the menu. */
interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

type MenuEntry = MenuItem | 'separator';

/**
 * Right-click menu for a submodule row. Which entries appear follows the
 * submodule's state: an uninitialized one can only be initialized or removed,
 * while a checked-out one can be opened, updated and deinitialized. "Update to
 * remote" needs a branch in `.gitmodules` — without one git silently falls back
 * to the remote's default branch, which is rarely what the user meant. The
 * destructive entries raise the shared confirm bar rather than acting outright.
 */
export function SubmoduleContextMenu({
  target,
  x,
  y,
  onClose,
  onOpenInNewTab,
  onInit,
  onUpdate,
  onUpdateRemote,
  onSync,
  onDeinit,
  onRemove,
}: SubmoduleContextMenuProps) {
  const requestConfirm = useConfirm();
  const initialized = target.state !== 'uninitialized';

  // Deinit refuses on local modifications; swap the bar to an explicit "force?"
  // prompt that spells out the consequence. Throwing keeps the bar open so the
  // new prompt survives the auto-close.
  const confirmDeinit = () =>
    requestConfirm({
      message: `Deinitialize “${target.path}”? Its folder is emptied; the entry in .gitmodules is kept, so it can be initialized again.`,
      cancelLabel: 'Cancel',
      actions: [
        {
          label: 'Deinitialize',
          tone: 'danger',
          busyLabel: 'Deinitializing…',
          onClick: async () => {
            if ((await onDeinit(target.path, false)) === 'needs-force') {
              requestConfirm({
                message: `“${target.path}” has uncommitted changes. Deinitialize anyway, discarding them?`,
                cancelLabel: 'Cancel',
                actions: [
                  {
                    label: 'Discard & deinitialize',
                    tone: 'danger',
                    busyLabel: 'Deinitializing…',
                    onClick: async () => {
                      await onDeinit(target.path, true);
                    },
                  },
                ],
              });
              throw new Error('needs-force'); // keep the (now-swapped) bar open
            }
          },
        },
      ],
    });

  const entries: MenuEntry[] = [];

  if (initialized) {
    entries.push({
      label: 'Open submodule in new tab',
      onClick: () => onOpenInNewTab(target.absolutePath),
    });
    entries.push('separator');
    entries.push({ label: 'Update submodule', onClick: () => onUpdate(target.path) });
  } else {
    entries.push({ label: 'Initialize submodule', onClick: () => onInit(target.path) });
  }

  if (target.branch) {
    entries.push({
      label: `Update to remote (${target.branch})`,
      onClick: () =>
        requestConfirm({
          message: `Move “${target.path}” to the tip of “${target.branch}”? The new revision is staged for you to commit.`,
          cancelLabel: 'Cancel',
          actions: [
            {
              label: 'Update to remote',
              tone: 'primary',
              busyLabel: 'Updating…',
              onClick: () => onUpdateRemote(target.path),
            },
          ],
        }),
    });
  }

  entries.push({ label: 'Sync URL from .gitmodules', onClick: () => onSync(target.path) });
  entries.push('separator');

  if (initialized) {
    entries.push({ label: 'Deinitialize submodule', danger: true, onClick: confirmDeinit });
  }

  entries.push({
    label: 'Remove submodule',
    danger: true,
    onClick: () =>
      requestConfirm({
        message: `Remove “${target.path}”? Its folder, its .gitmodules entry and its internal clone are deleted. The removal is staged for you to commit.`,
        cancelLabel: 'Cancel',
        actions: [
          {
            label: 'Remove',
            tone: 'danger',
            busyLabel: 'Removing…',
            onClick: () => onRemove(target.path),
          },
        ],
      }),
  });

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
