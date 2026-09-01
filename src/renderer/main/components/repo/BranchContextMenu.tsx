import { useState } from 'react';
import type { ResetMode, ResetPreview } from '../../../../types/ipc';
import { useConfirm } from '../ConfirmBar';
import {
  ContextMenu,
  MenuRow,
  type ContextMenuEntry,
  type ContextMenuItem,
} from './ContextMenu';

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
  /**
   * Cherry-pick this menu's commit onto the checked-out branch. Targets the
   * commit rather than any branch above, so it sits in its own group; omit to
   * hide the row.
   */
  onCherryPick?: () => void;
  /**
   * Revert this menu's commit, recording a new commit on the checked-out branch
   * that undoes it. Conflicts surface the resolver, like cherry-pick.
   */
  onRevert?: () => void;
  /**
   * Rebase the checked-out branch onto this menu's commit, replaying its commits
   * on top. Conflicts surface the resolver, like a branch rebase.
   */
  onRebaseOnto?: () => void;
  /**
   * Open the interactive-rebase editor starting at this menu's commit (reorder /
   * pick / reword / squash / drop the commits from here up to HEAD). Omit to hide.
   */
  onInteractiveRebase?: () => void;
  /** How many children sit on top of this commit — shown in the rebase row's label. */
  rebaseChildCount?: number;
  /**
   * Check out this menu's commit itself, detaching HEAD from any branch. Offered
   * for every commit but the checked-out one; omit to hide the row.
   */
  onCheckoutCommit?: () => void;
  /**
   * Reset the checked-out branch back to this menu's commit, dropping every
   * commit after it. Offered as a submenu of the three modes; omit to hide it.
   * Pairs with {@link onResetPreview}, which the hard-reset confirmation needs.
   */
  onReset?: (mode: ResetMode) => void;
  /** How many commits a reset here would drop, and whether the tree is dirty. */
  onResetPreview?: () => Promise<ResetPreview>;
  /** Abbreviated hash of this menu's commit, named in the hard-reset confirmation. */
  shortHash?: string;
  /**
   * Start creating a lightweight tag at this menu's commit. When provided
   * together with {@link onCreateAnnotatedTagHere}, the two "Create tag here"
   * rows are appended below a separator; omit both to hide the tag section.
   */
  onCreateTagHere?: () => void;
  /** Start creating an annotated tag at this menu's commit (see above). */
  onCreateAnnotatedTagHere?: () => void;
}

/** One row in the menu (a leaf action, or a parent opening a submenu). */
type MenuItem = ContextMenuItem;

/** A menu row or a divider between action groups. */
type MenuEntry = ContextMenuEntry;

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
  // one that differs from this target. A local target is addressed by its name; a
  // remote-tracking one by its `remote/name` committish (so remote branches get
  // the same actions cherry-pick offers). The current branch's own remote-tracking
  // ref shares its name and is skipped — integrating a branch with itself is a no-op.
  if (currentBranch && !target.isCurrent && target.name !== currentBranch) {
    const committish = target.local ? target.name : `${target.remoteName}/${target.name}`;
    actions.push({
      label: `Merge into ${currentBranch}`,
      onClick: () => h.onMerge(committish, currentBranch),
    });
    actions.push({
      label: `Rebase ${currentBranch} onto ${target.name}`,
      onClick: () => h.onRebase(committish, currentBranch),
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
  onCherryPick,
  onRevert,
  onRebaseOnto,
  onInteractiveRebase,
  rebaseChildCount,
  onCheckoutCommit,
  onReset,
  onResetPreview,
  shortHash,
  onCreateTagHere,
  onCreateAnnotatedTagHere,
}: BranchContextMenuProps) {
  const requestConfirm = useConfirm();
  // The row whose submenu is currently open (index into `entries`), if any.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
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

  // Checking out the commit itself detaches HEAD, so — like cherry-pick — it
  // targets the commit rather than any branch above and gets its own group.
  if (onCheckoutCommit) {
    if (entries.length) entries.push('separator');
    entries.push({ label: 'Checkout this commit', onClick: onCheckoutCommit });
  }

  // Rebase replays the checked-out branch's commits on top of this commit, so it
  // targets the commit and gets its own group — placed just above reset since
  // both rewrite where the current branch's history sits. It confirms first
  // because a rebase rewrites commits (new hashes) and can conflict.
  if (onRebaseOnto) {
    if (entries.length) entries.push('separator');
    entries.push({
      label: currentBranch
        ? `Rebase ${currentBranch} onto this commit`
        : 'Rebase onto this commit', // detached HEAD: there's no branch to name
      onClick: () =>
        requestConfirm({
          message:
            `Rebase ${currentBranch ?? 'HEAD'} onto ${shortHash ?? 'this commit'}? ` +
            'This replays your commits on top of it, rewriting them with new hashes.',
          actions: [
            { label: 'Rebase', tone: 'primary', busyLabel: 'Rebasing…', onClick: onRebaseOnto },
          ],
        }),
    });
  }

  // Interactive rebase opens the editor for this commit's children (the commits
  // replayed on top of it), grouped with the other rebase rows. It doesn't
  // confirm: the editor itself is the review step, and closing it backs out
  // before anything is rewritten. The label names the count and the base commit,
  // like GitKraken's "Interactive Rebase N children onto <hash>".
  if (onInteractiveRebase) {
    const count = rebaseChildCount ?? 0;
    if (entries.length) entries.push('separator');
    entries.push({
      label: `Interactive Rebase ${count} ${count === 1 ? 'child' : 'children'} on ${shortHash ?? 'this commit'}`,
      onClick: onInteractiveRebase,
    });
  }

  // Reset moves the *branch* back to this commit (unlike checkout, which moves
  // only HEAD), so it targets the checked-out branch and gets its own group. The
  // three modes hang off a submenu because only one of them — hard — is
  // destructive, and burying it there keeps it off the top level.
  if (onReset) {
    if (entries.length) entries.push('separator');
    entries.push({
      label: currentBranch
        ? `Reset ${currentBranch} to this commit`
        : 'Reset HEAD to this commit', // detached HEAD: there's no branch to name
      submenu: [
        { label: 'Soft — keep the changes staged', onClick: () => onReset('soft') },
        { label: 'Mixed — keep the changes unstaged', onClick: () => onReset('mixed') },
        {
          label: 'Hard — discard the changes',
          danger: true,
          // The only mode that can destroy work, so it always confirms — and the
          // preview lets the prompt say what's actually at stake.
          onClick: async () => {
            const preview = await onResetPreview?.();
            const dropped = preview?.commits ?? 0;
            const target = currentBranch ?? 'HEAD';
            const at = shortHash ? ` to ${shortHash}` : '';
            const commits =
              dropped > 0 ? ` This drops ${dropped} commit${dropped === 1 ? '' : 's'}` : ' This drops no commits';
            const dirty = preview?.dirty ? ' and discards your uncommitted changes' : '';
            requestConfirm({
              message:
                `Hard reset ${target}${at}?${commits}${dirty}. ` +
                'The commits stay recoverable with Undo; uncommitted changes don’t.',
              actions: [
                {
                  label: 'Hard reset',
                  tone: 'danger',
                  busyLabel: 'Resetting…',
                  onClick: () => onReset('hard'),
                },
              ],
            });
          },
        },
      ],
    });
  }


  // Revert targets the commit — it records a new commit undoing it on the
  // checked-out branch — so it sits with the other commit actions. It confirms
  // first: unlike cherry-pick it's usually a deliberate "undo this change" and
  // adds a commit to history, so a stray click shouldn't do it silently.
  if (onRevert) {
    if (entries.length) entries.push('separator');
    entries.push({
      label: 'Revert this commit',
      onClick: () =>
        requestConfirm({
          message:
            `Revert ${shortHash ?? 'this commit'}? This adds a new commit that ` +
            'undoes its changes on the current branch.',
          actions: [{ label: 'Revert', tone: 'primary', busyLabel: 'Reverting…', onClick: onRevert }],
        }),
    });
  }

  // Cherry-pick targets the commit itself (applying it onto the checked-out
  // branch), so like the tag actions it's divided off from the branch groups.
  if (onCherryPick) {
    if (entries.length) entries.push('separator');
    entries.push({
      label: currentBranch ? `Cherry-pick onto ${currentBranch}` : 'Cherry-pick',
      onClick: onCherryPick,
    });
  }

  // Tag actions sit in their own group at the bottom — creating a tag targets
  // the commit, not any one of the branches above, so it's divided off.
  if (onCreateTagHere && onCreateAnnotatedTagHere) {
    if (entries.length) entries.push('separator');
    entries.push({ label: 'Create tag here', onClick: onCreateTagHere });
    entries.push({ label: 'Create annotated tag here', onClick: onCreateAnnotatedTagHere });
  }

  if (entries.length === 0) return null;

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {entries.map((entry, index) =>
        entry === 'separator' ? (
          <div key={`sep-${index}`} className="context-menu-sep" role="separator" />
        ) : (
          <MenuRow
            key={`${entry.label}-${index}`}
            item={entry}
            open={openIndex === index}
            // Hovering a plain row closes any open submenu; a parent row opens its own.
            onHover={() => setOpenIndex(entry.submenu?.length ? index : null)}
            onClose={onClose}
          />
        ),
      )}
    </ContextMenu>
  );
}
