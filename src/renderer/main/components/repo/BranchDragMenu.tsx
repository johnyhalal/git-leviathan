import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A branch involved in a sidebar drag: its bare name plus the remote it lives on
 * (`null` for a local branch). The pair (name, remote) identifies one row.
 */
export interface DragBranchRef {
  /** Bare branch name, e.g. `feature/x` (never the `origin/` prefix). */
  name: string;
  /** The remote it lives on (`origin`, …), or `null` for a local branch. */
  remote: string | null;
}

/** The git ref string for a drag ref: `name` for a local, `remote/name` otherwise. */
export function refString(ref: DragBranchRef): string {
  return ref.remote ? `${ref.remote}/${ref.name}` : ref.name;
}

/** Whether two drag refs are the same row (same name and same locality). */
export function sameRef(a: DragBranchRef, b: DragBranchRef): boolean {
  return a.name === b.name && a.remote === b.remote;
}

/**
 * The actions offered when dropping `source` (the dragged branch) onto `target`
 * depend on which of the two is local vs. remote:
 * - local → local:  fast-forward, merge, rebase
 * - remote → local: fast-forward, merge
 * - local → remote: rebase, push, push & start a pull request (the last needs a host)
 * - remote → remote: start a pull request from source to target (same remote, needs a host)
 *
 * `canPullRequest` gates the host-backed actions (a connected GitHub/GitLab). This
 * predicate is used to decide whether a drop has any actions at all before opening
 * the menu; {@link BranchDragMenu} renders the matching entries.
 */
export function hasDragActions(
  source: DragBranchRef,
  target: DragBranchRef,
  canPullRequest: boolean,
): boolean {
  if (sameRef(source, target)) return false;
  const sourceRemote = source.remote !== null;
  const targetRemote = target.remote !== null;
  if (!sourceRemote && !targetRemote) return true; // local → local
  if (sourceRemote && !targetRemote) return true; // remote → local
  if (!sourceRemote && targetRemote) return true; // local → remote
  // remote → remote: only a pull request, and only within one remote / a host.
  return canPullRequest && source.remote === target.remote;
}

/** The callbacks the menu invokes; each maps to one repo mutation in RepoView. */
export interface DragMenuHandlers {
  /** Fast-forward the local branch `target` to `source` (`merge --ff-only`). */
  onFastForward: (source: string, target: string) => void;
  /** Merge `source` into the local branch `target`. */
  onMerge: (source: string, target: string) => void;
  /** Check out the local branch `target`, then rebase it onto `source`. */
  onRebase: (source: string, target: string) => void;
  /** Push the local branch `localBranch` to `remoteBranch` on `remote`. */
  onPush: (remote: string, localBranch: string, remoteBranch: string) => void;
  /**
   * Push the local branch `localBranch` to its own branch on `remote`, then open
   * a new pull request from `prSource` into `prTarget`.
   */
  onPushAndPullRequest: (
    remote: string,
    localBranch: string,
    prSource: string,
    prTarget: string,
  ) => void;
  /** Open a new pull request from `prSource` into `prTarget`. */
  onStartPullRequest: (prSource: string, prTarget: string) => void;
}

interface MenuItem {
  label: ReactNode;
  onClick: () => void;
}

/** Build the concrete menu items for a source→target drop. */
function buildItems(
  source: DragBranchRef,
  target: DragBranchRef,
  canPullRequest: boolean,
  h: DragMenuHandlers,
): MenuItem[] {
  const sourceRemote = source.remote !== null;
  const targetRemote = target.remote !== null;
  const sourceLabel = refString(source);
  const targetLabel = refString(target);
  const items: MenuItem[] = [];

  if (!sourceRemote && !targetRemote) {
    // local → local. The *dragged* branch (source) is the one that moves — you
    // pick it up and drop it onto its destination (target) — so it's the branch
    // checked out and updated, with the drop target as the reference.
    items.push({
      label: (
        <>
          Fast-forward <strong>{source.name}</strong> to <strong>{target.name}</strong>
        </>
      ),
      onClick: () => h.onFastForward(target.name, source.name),
    });
    items.push({
      label: (
        <>
          Merge <strong>{target.name}</strong> into <strong>{source.name}</strong>
        </>
      ),
      onClick: () => h.onMerge(target.name, source.name),
    });
    items.push({
      label: (
        <>
          Rebase <strong>{source.name}</strong> onto <strong>{target.name}</strong>
        </>
      ),
      onClick: () => h.onRebase(target.name, source.name),
    });
  } else if (sourceRemote && !targetRemote) {
    // remote → local
    items.push({
      label: (
        <>
          Fast-forward <strong>{target.name}</strong> to <strong>{sourceLabel}</strong>
        </>
      ),
      onClick: () => h.onFastForward(sourceLabel, target.name),
    });
    items.push({
      label: (
        <>
          Merge <strong>{sourceLabel}</strong> into <strong>{target.name}</strong>
        </>
      ),
      onClick: () => h.onMerge(sourceLabel, target.name),
    });
  } else if (!sourceRemote && targetRemote) {
    // local → remote
    items.push({
      label: (
        <>
          Rebase <strong>{source.name}</strong> onto <strong>{targetLabel}</strong>
        </>
      ),
      // Check out the local source, then rebase it onto the remote target ref.
      onClick: () => h.onRebase(targetLabel, source.name),
    });
    items.push({
      label: (
        <>
          Push <strong>{source.name}</strong> to <strong>{targetLabel}</strong>
        </>
      ),
      onClick: () => h.onPush(target.remote as string, source.name, target.name),
    });
    if (canPullRequest) {
      items.push({
        label: (
          <>
            Push <strong>{source.name}</strong> and start a pull request
          </>
        ),
        onClick: () =>
          h.onPushAndPullRequest(target.remote as string, source.name, source.name, target.name),
      });
    }
  } else if (canPullRequest && source.remote === target.remote) {
    // remote → remote
    items.push({
      label: (
        <>
          Start a pull request from <strong>{sourceLabel}</strong> to <strong>{targetLabel}</strong>
        </>
      ),
      onClick: () => h.onStartPullRequest(source.name, target.name),
    });
  }

  return items;
}

interface BranchDragMenuProps {
  source: DragBranchRef;
  target: DragBranchRef;
  /** Viewport coordinates to anchor the menu at (the drop point). */
  x: number;
  y: number;
  /** Whether a connected host makes the pull-request actions available. */
  canPullRequest: boolean;
  handlers: DragMenuHandlers;
  /** Dismiss the menu (outside click, Escape, or after a choice). */
  onClose: () => void;
}

/**
 * The menu shown where one sidebar branch was dropped onto another. Its entries
 * are the merge/rebase/push/pull-request actions valid for the source→target
 * local/remote combination (see {@link hasDragActions}). Dismisses on an outside
 * click, Escape, or after a choice. Reuses the commit graph's `.branch-drop-menu`
 * styling.
 */
export function BranchDragMenu({
  source,
  target,
  x,
  y,
  canPullRequest,
  handlers,
  onClose,
}: BranchDragMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // Capture so a click anywhere (even inside a stop-propagating row) closes it.
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const items = buildItems(source, target, canPullRequest, handlers);
  if (items.length === 0) return null;

  return (
    <div ref={ref} className="branch-drop-menu" style={{ left: x, top: y }} role="menu">
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          className="branch-drop-item"
          role="menuitem"
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
