import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import type {
  CommitLogEntry,
  ConflictFile,
  GitflowConfig,
  GitflowKind,
  RepoRefs,
  WorkingStatus,
} from '../../../../types/ipc';
import { RepoSidebar } from './RepoSidebar';
import type { RepoSettingsTabId } from './RepoSettingsDialog';
import type { WorktreeRemoveOutcome } from './WorktreeContextMenu';
import type { SubmoduleDeinitOutcome } from './SubmoduleContextMenu';
import { CommitList } from './CommitList';
import { CommitPanel } from './CommitPanel';
import { DiffView, type DiffTarget } from './DiffView';
import { ResizeHandle } from './ResizeHandle';
import { useResizableColumns } from './useResizableColumns';

interface RepoColumnsProps {
  repoPath: string;
  /** The checked-out branch name (undefined when detached), shown in the panel. */
  branch?: string;
  refs: RepoRefs | null;
  commits: CommitLogEntry[] | null;
  /** The shared working-tree status (staged/unstaged), or null while loading. */
  workingStatus: WorkingStatus | null;
  /** Push a fresh working-tree status up (after stage/unstage/commit). */
  onWorkingStatusChange: (status: WorkingStatus) => void;
  /** Unmerged files from the in-progress operation (empty when none). */
  conflicts: ConflictFile[];
  /** Mark conflict(s) resolved by staging them; null marks every conflict. */
  onMarkResolved: (file: string | null) => void;
  /** Open the conflict resolver focused on a specific conflicted file. */
  onOpenConflict: (file: string) => void;
  /** The shared commit message (mirrored between the working row and the panel). */
  commitMessage: string;
  /** Update the shared commit message. */
  onCommitMessageChange: (message: string) => void;
  /** Whether another page of history is currently being fetched. */
  loadingMore: boolean;
  /** Request the next page of history (scrolled near the bottom of the list). */
  onLoadMore: () => void;
  /** Called after a successful commit so history/refs reload. */
  onCommitted: () => void;
  /**
   * A counter bumped by the parent after a push/pull lands. Any change closes an
   * open diff (a pull can rewrite the file it was showing), returning the center
   * pane to the commit list.
   */
  closeDiffToken: number;
  /**
   * Check out a branch (double-clicking it in the sidebar). Pass `remote` for a
   * remote branch so a tracking branch is created off that specific remote.
   */
  onCheckout: (branch: string, remote?: string) => void;
  /** Whether the inline "new branch" input is shown at the HEAD commit. */
  creatingBranch: boolean;
  /** Create a branch at HEAD with the entered name (Enter in the inline input). */
  onCreateBranch: (name: string) => void;
  /** Dismiss the inline "new branch" input without creating (Escape / blur). */
  onCancelCreateBranch: () => void;
  /** Merge one local branch into another (dragging a branch badge onto another). */
  onMergeBranch: (source: string, target: string) => void;
  /** Rebase one local branch onto another (dragging a branch badge onto another). */
  onRebaseBranch: (source: string, target: string) => void;
  /** Fast-forward the local branch `target` to `source` (sidebar branch drag). */
  onFastForward: (source: string, target: string) => void;
  /** Cherry-pick the commit `hash` onto HEAD (from a commit's context menu). */
  onCherryPick: (hash: string) => void;
  /** Push a local branch to a remote branch (sidebar branch drag); resolves success. */
  onPushBranch: (remote: string, localBranch: string, remoteBranch: string) => Promise<boolean>;
  /** Rename a local branch (`git branch -m`), from a branch's context menu. */
  onRenameBranch: (oldName: string, newName: string) => void;
  /** Delete a local branch (`git branch -D`), from a branch's context menu. */
  onDeleteBranch: (branch: string) => void;
  /** Delete a branch on its remote (`git push <remote> --delete`). */
  onDeleteRemoteBranch: (remote: string, branch: string) => void;
  /** The commit a tag is being created at (its inline name input), or null. */
  taggingAt: { hash: string; annotated: boolean } | null;
  /** Begin creating a tag at `hash` (from a commit row's context menu). */
  onStartTag: (hash: string, annotated: boolean) => void;
  /** Begin creating a tag at the tip of `branch` (from a sidebar branch menu). */
  onStartTagAtBranch: (branch: string, annotated: boolean) => void;
  /** Create a lightweight tag `name` at `hash`. */
  onCreateTag: (hash: string, name: string) => void;
  /** Create an annotated tag `name` at `hash` with `message`. */
  onCreateAnnotatedTag: (hash: string, name: string, message: string) => void;
  /** Dismiss the inline tag input without creating. */
  onCancelTag: () => void;
  /** Re-create the tag `name` as annotated with `message` (tags section menu). */
  onAnnotateTag: (name: string, message: string) => void;
  /** The remote the tag menu's push/delete actions target, or undefined when none. */
  tagRemote?: string;
  /** Tag names already on `tagRemote`, or null when it couldn't be determined. */
  pushedTags: Set<string> | null;
  /** Push the tag `name` to `remote` (`git push <remote> refs/tags/<name>`). */
  onPushTag: (name: string, remote: string) => void;
  /** Delete the tag `name` on `remote` (local tag kept). */
  onDeleteRemoteTag: (name: string, remote: string) => void;
  /** Delete the local tag `name` (`git tag -d`). */
  onDeleteTag: (name: string) => void;
  /** Apply a stash by index, keeping it (`git stash apply`). */
  onStashApply: (index: number) => void;
  /** Apply & drop a stash by index (`git stash pop`). */
  onStashPop: (index: number) => void;
  /** Discard a stash by index (`git stash drop`). */
  onStashDrop: (index: number) => void;
  /** A worktree was added via the dialog: refs should reload. */
  onWorktreeAdded: () => void;
  /** Remove the worktree at `path`; resolves whether it needs a forced retry. */
  onWorktreeRemove: (
    path: string,
    force: boolean,
    deleteBranch: boolean,
  ) => Promise<WorktreeRemoveOutcome>;
  /** Lock (`lock: true`, with optional reason) or unlock the worktree at `path`. */
  onWorktreeLock: (path: string, lock: boolean, reason?: string) => void;
  /** Open a worktree's folder as a repository in the current tab. */
  onOpenWorktreeHere: (path: string) => void;
  /** Open a worktree's or submodule's folder as a repository in a new tab. */
  onOpenWorktreeInNewTab: (path: string) => void;
  /** A submodule was added via the dialog: refs should reload. */
  onSubmoduleAdded: () => void;
  /** Initialize the submodule at `path`, or every one when omitted. */
  onSubmoduleInit: (path?: string) => void;
  /** Update the submodule at `path` to its recorded commit, or every one. */
  onSubmoduleUpdate: (path?: string) => void;
  /** Move the submodule at `path` to its upstream branch tip. */
  onSubmoduleUpdateRemote: (path: string) => void;
  /** Re-apply the URL in `.gitmodules` to the submodule at `path`. */
  onSubmoduleSync: (path: string) => void;
  /** Deinitialize the submodule at `path`; resolves whether it needs forcing. */
  onSubmoduleDeinit: (path: string, force: boolean) => Promise<SubmoduleDeinitOutcome>;
  /** Remove the submodule at `path` entirely. */
  onSubmoduleRemove: (path: string) => void;
  /** The repo's gitflow config, or null when it hasn't been configured yet. */
  gitflowConfig: GitflowConfig | null;
  /** Start a gitflow topic branch of `kind` named `name`, based off `source`. */
  onGitflowStart: (kind: GitflowKind, name: string, source: string) => void;
  /** Finish the current gitflow topic branch. */
  onGitflowFinish: () => void;
  onError?: (title: string, message: string) => void;
  /** Open the settings modal, optionally to a specific section id. */
  onOpenSettings?: (section?: string) => void;
  /** Open the per-repository settings dialog, optionally to a specific tab. */
  onOpenRepoSettings?: (tab?: RepoSettingsTabId) => void;
}

/**
 * Three-column body: sidebar | commit list | commit panel. The outer columns
 * have draggable widths; the middle commit list flexes to fill the rest.
 *
 * Selecting a commit in the list drives the right panel between its two states:
 * a chosen commit shows details, no selection shows the working-tree staging UI.
 */
export function RepoColumns({
  repoPath,
  branch,
  refs,
  commits,
  workingStatus,
  onWorkingStatusChange,
  conflicts,
  onMarkResolved,
  onOpenConflict,
  commitMessage,
  onCommitMessageChange,
  loadingMore,
  onLoadMore,
  onCommitted,
  closeDiffToken,
  onCheckout,
  creatingBranch,
  onCreateBranch,
  onCancelCreateBranch,
  onMergeBranch,
  onCherryPick,
  onRebaseBranch,
  onFastForward,
  onPushBranch,
  onRenameBranch,
  onDeleteBranch,
  onDeleteRemoteBranch,
  taggingAt,
  onStartTag,
  onStartTagAtBranch,
  onCreateTag,
  onCreateAnnotatedTag,
  onCancelTag,
  onAnnotateTag,
  tagRemote,
  pushedTags,
  onPushTag,
  onDeleteRemoteTag,
  onDeleteTag,
  onStashApply,
  onStashPop,
  onStashDrop,
  onWorktreeAdded,
  onWorktreeRemove,
  onWorktreeLock,
  onOpenWorktreeHere,
  onOpenWorktreeInNewTab,
  onSubmoduleAdded,
  onSubmoduleInit,
  onSubmoduleUpdate,
  onSubmoduleUpdateRemote,
  onSubmoduleSync,
  onSubmoduleDeinit,
  onSubmoduleRemove,
  gitflowConfig,
  onGitflowStart,
  onGitflowFinish,
  onError,
  onOpenSettings,
  onOpenRepoSettings,
}: RepoColumnsProps) {
  const { leftWidth, rightWidth, startResize } = useResizableColumns(240, 320);
  // `selectedHash` is the focused commit (drives the detail panel + auto-scroll);
  // `selectedHashes` is every highlighted row (multi-select); `anchorHash` is the
  // pivot a Shift-range extends from — set only on plain/⌘ clicks, not Shift ones.
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [selectedHashes, setSelectedHashes] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [anchorHash, setAnchorHash] = useState<string | null>(null);
  // The file opened in the center diff viewer, or null to show the commit list.
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);

  // Collapse the selection to a single commit (or clear it with null), keeping
  // the three selection pieces in sync. Every non-mouse selection path (initial
  // preselect, post-commit, sidebar ref/stash picks, panel navigation) routes
  // through here so it also resets the multi-select set and range anchor.
  const selectSingle = useCallback((hash: string | null) => {
    setSelectedHash(hash);
    setSelectedHashes(hash ? new Set([hash]) : new Set());
    setAnchorHash(hash);
  }, []);

  // Switching repos or selecting a different commit makes any open diff stale
  // (it was taken from the previous commit/working tree), so close it.
  useEffect(() => {
    setDiffTarget(null);
  }, [repoPath, selectedHash]);

  // A push/pull just landed (the parent bumped this token): a pull can rewrite
  // the file the diff was showing, so drop back to the commit list. The initial
  // mount runs this too, which is harmless — nothing is open yet.
  useEffect(() => {
    setDiffTarget(null);
  }, [closeDiffToken]);

  // On opening a repo, preselect the latest real commit — skipping the synthetic
  // working-tree row and any stash rows. Keyed on repoPath so it runs once per
  // repo and never clobbers a manual selection on later reloads.
  const initializedRepo = useRef<string | null>(null);
  useEffect(() => {
    if (initializedRepo.current === repoPath) return;
    const latest = commits?.find((commit) => !commit.working && commit.stashIndex === undefined);
    if (latest) {
      selectSingle(latest.hash);
      initializedRepo.current = repoPath;
    }
  }, [repoPath, commits, selectSingle]);

  // The working-tree row isn't a real commit — selecting it highlights the row
  // but leaves the panel on the staging view (a null selection), so it's
  // excluded from what counts as the selected commit.
  const selectedCommit =
    commits?.find((commit) => commit.hash === selectedHash && !commit.working) ?? null;

  // The real commits in the multi-select (list order, newest-first), excluding
  // the synthetic working-tree and stash rows. Drives the multi-commit panel.
  const selectedCommits = useMemo(
    () =>
      (commits ?? []).filter(
        (commit) =>
          selectedHashes.has(commit.hash) && !commit.working && commit.stashIndex === undefined,
      ),
    [commits, selectedHashes],
  );

  // After a successful commit, close the working staging view and select the
  // freshly created commit. The new hash isn't known until history reloads, so
  // remember the *pre-commit* tip and, once a different tip appears, select it.
  // Keying on "different from the old tip" (not just "armed") is load-bearing:
  // committing first clears the working status, which drops the synthetic
  // working row and re-renders with the old commits (new array identity) before
  // the reload runs — a plain flag would latch onto that stale old tip and never
  // advance to the new commit. `null` means inactive; an object arms the wait.
  const selectTipAfterReload = useRef<{ prevTip: string | null } | null>(null);
  const tipHash = () =>
    commits?.find((commit) => !commit.working && commit.stashIndex === undefined)?.hash ?? null;
  const handleCommitted = () => {
    selectTipAfterReload.current = { prevTip: tipHash() };
    onCommitted();
  };
  useEffect(() => {
    const pending = selectTipAfterReload.current;
    if (!pending) return;
    const tip = tipHash();
    if (tip && tip !== pending.prevTip) {
      selectSingle(tip);
      selectTipAfterReload.current = null;
    }
  }, [commits, selectSingle]);

  // Select a commit from a mouse click in the list, honouring the modifier keys:
  //   • Shift  — extend a contiguous range from the anchor to the clicked row.
  //   • ⌘/Ctrl — toggle the clicked row in/out of the current selection.
  //   • plain  — collapse to just this row (re-clicking the lone selection clears
  //              it, returning to the working view — the single-select toggle).
  const selectCommit = (hash: string, modifiers: { shift: boolean; meta: boolean }) => {
    const list = commits ?? [];
    if (modifiers.shift && anchorHash) {
      const from = list.findIndex((commit) => commit.hash === anchorHash);
      const to = list.findIndex((commit) => commit.hash === hash);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        setSelectedHashes(new Set(list.slice(lo, hi + 1).map((commit) => commit.hash)));
        setSelectedHash(hash); // focus the clicked end; the anchor stays put
        return;
      }
    }
    if (modifiers.meta) {
      const willSelect = !selectedHashes.has(hash);
      setSelectedHashes((prev) => {
        const next = new Set(prev);
        if (next.has(hash)) next.delete(hash);
        else next.add(hash);
        return next;
      });
      setAnchorHash(hash);
      if (willSelect) setSelectedHash(hash);
      else if (selectedHash === hash) setSelectedHash(null);
      return;
    }
    if (selectedHashes.size === 1 && selectedHashes.has(hash)) selectSingle(null);
    else selectSingle(hash);
  };

  // Load the next page once the scroll position nears the bottom. onLoadMore is
  // a no-op while a fetch is in flight or the end is reached, so firing on every
  // scroll tick is safe.
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) onLoadMore();
  };

  // Selecting a ref in the sidebar highlights the commit it points at. That
  // commit is decorated with the ref: a local branch shows up as a `branch` ref
  // (or `head`, `HEAD -> name`, when checked out); a remote branch as a `remote`
  // ref labelled `remote/name`; a tag as a `tag` ref labelled with its name.
  const selectRefTip = (label: string) => {
    const tip = commits?.find((commit) =>
      commit.refs.some((ref) => ref.label === label),
    );
    if (tip) selectSingle(tip.hash);
  };

  // Stashes carry no ref decoration, so they're matched by their stash index
  // (the `stashIndex` on the woven-in stash rows) rather than by a ref label.
  const selectStash = (index: number) => {
    const row = commits?.find((commit) => commit.stashIndex === index);
    if (row) selectSingle(row.hash);
  };

  return (
    <div className="repo-columns">
      <div className="repo-column repo-column-left" style={{ width: leftWidth }}>
        <RepoSidebar
          repoPath={repoPath}
          refs={refs}
          onSelectRef={selectRefTip}
          onSelectStash={selectStash}
          onCheckout={onCheckout}
          onMergeBranch={onMergeBranch}
          onRebaseBranch={onRebaseBranch}
          onFastForward={onFastForward}
          onCherryPick={onCherryPick}
          onPushBranch={onPushBranch}
          onRenameBranch={onRenameBranch}
          onDeleteBranch={onDeleteBranch}
          onDeleteRemoteBranch={onDeleteRemoteBranch}
          onStartTagAtBranch={onStartTagAtBranch}
          onAnnotateTag={onAnnotateTag}
          tagRemote={tagRemote}
          pushedTags={pushedTags}
          onPushTag={onPushTag}
          onDeleteRemoteTag={onDeleteRemoteTag}
          onDeleteTag={onDeleteTag}
          onStashApply={onStashApply}
          onStashPop={onStashPop}
          onStashDrop={onStashDrop}
          onWorktreeAdded={onWorktreeAdded}
          onWorktreeRemove={onWorktreeRemove}
          onWorktreeLock={onWorktreeLock}
          onOpenWorktreeHere={onOpenWorktreeHere}
          onOpenWorktreeInNewTab={onOpenWorktreeInNewTab}
          onSubmoduleAdded={onSubmoduleAdded}
          onSubmoduleInit={onSubmoduleInit}
          onSubmoduleUpdate={onSubmoduleUpdate}
          onSubmoduleUpdateRemote={onSubmoduleUpdateRemote}
          onSubmoduleSync={onSubmoduleSync}
          onSubmoduleDeinit={onSubmoduleDeinit}
          onSubmoduleRemove={onSubmoduleRemove}
          gitflowConfig={gitflowConfig}
          onGitflowStart={onGitflowStart}
          onGitflowFinish={onGitflowFinish}
          onOpenSettings={onOpenSettings}
          onOpenRepoSettings={onOpenRepoSettings}
        />
      </div>

      <ResizeHandle side="left" aria-label="Resize sidebar" onPointerDown={startResize('left')} />

      <div
        className="repo-column repo-column-center"
        onScroll={diffTarget ? undefined : handleScroll}
      >
        {diffTarget ? (
          <DiffView
            repoPath={repoPath}
            target={diffTarget}
            onClose={() => setDiffTarget(null)}
            onWorkingStatusChange={onWorkingStatusChange}
          />
        ) : (
          <CommitList
            commits={commits}
            selectedHash={selectedHash}
            selectedHashes={selectedHashes}
            currentBranch={branch}
            remotes={refs?.remotes}
            workingStatus={workingStatus}
            commitMessage={commitMessage}
            onCommitMessageChange={onCommitMessageChange}
            loadingMore={loadingMore}
            onSelect={selectCommit}
            onCheckout={onCheckout}
            creatingBranch={creatingBranch}
            onCreateBranch={onCreateBranch}
            onCancelCreateBranch={onCancelCreateBranch}
            taggingAt={taggingAt}
            onStartTag={onStartTag}
            onCreateTag={onCreateTag}
            onCreateAnnotatedTag={onCreateAnnotatedTag}
            onCancelTag={onCancelTag}
            tagRemote={tagRemote}
            pushedTags={pushedTags}
            onAnnotateTag={onAnnotateTag}
            onPushTag={onPushTag}
            onDeleteRemoteTag={onDeleteRemoteTag}
            onDeleteTag={onDeleteTag}
            onMergeBranch={onMergeBranch}
            onRebaseBranch={onRebaseBranch}
            onCherryPick={onCherryPick}
            onRenameBranch={onRenameBranch}
            onDeleteBranch={onDeleteBranch}
            onDeleteRemoteBranch={onDeleteRemoteBranch}
          />
        )}
      </div>

      <ResizeHandle side="right" aria-label="Resize commit panel" onPointerDown={startResize('right')} />

      <div className="repo-column repo-column-right" style={{ width: rightWidth }}>
        <CommitPanel
          commit={selectedCommit}
          selectedCommits={selectedCommits}
          repoPath={repoPath}
          branch={branch}
          workingStatus={workingStatus}
          onWorkingStatusChange={onWorkingStatusChange}
          conflicts={conflicts}
          onMarkResolved={onMarkResolved}
          onOpenConflict={onOpenConflict}
          commitMessage={commitMessage}
          onCommitMessageChange={onCommitMessageChange}
          onCommitted={handleCommitted}
          onViewWorking={() => selectSingle(commits?.[0]?.hash ?? null)}
          onSelectCommit={selectSingle}
          onOpenDiff={setDiffTarget}
          onCloseDiff={() => setDiffTarget(null)}
          activeDiff={diffTarget}
          onError={onError}
          onOpenSettings={onOpenSettings}
        />
      </div>
    </div>
  );
}
