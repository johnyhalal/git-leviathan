import { useEffect, useRef, useState, type UIEvent } from 'react';
import type {
  CommitLogEntry,
  GitflowKind,
  RepoRefs,
  WorkingStatus,
} from '../../../../types/ipc';
import { RepoSidebar } from './RepoSidebar';
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
   * Check out a branch (double-clicking it in the sidebar). Pass `remote` for a
   * remote branch so a tracking branch is created off that specific remote.
   */
  onCheckout: (branch: string, remote?: string) => void;
  /** Apply & drop a stash by index (`git stash pop`). */
  onStashPop: (index: number) => void;
  /** Discard a stash by index (`git stash drop`). */
  onStashDrop: (index: number) => void;
  /** Start a gitflow topic branch of `kind` named `name`. */
  onGitflowStart: (kind: GitflowKind, name: string) => void;
  /** Finish the current gitflow topic branch. */
  onGitflowFinish: () => void;
  onError?: (title: string, message: string) => void;
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
  commitMessage,
  onCommitMessageChange,
  loadingMore,
  onLoadMore,
  onCommitted,
  onCheckout,
  onStashPop,
  onStashDrop,
  onGitflowStart,
  onGitflowFinish,
  onError,
}: RepoColumnsProps) {
  const { leftWidth, rightWidth, startResize } = useResizableColumns(240, 320);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  // The file opened in the center diff viewer, or null to show the commit list.
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);

  // Switching repos or selecting a different commit makes any open diff stale
  // (it was taken from the previous commit/working tree), so close it.
  useEffect(() => {
    setDiffTarget(null);
  }, [repoPath, selectedHash]);

  // On opening a repo, preselect the latest real commit — skipping the synthetic
  // working-tree row and any stash rows. Keyed on repoPath so it runs once per
  // repo and never clobbers a manual selection on later reloads.
  const initializedRepo = useRef<string | null>(null);
  useEffect(() => {
    if (initializedRepo.current === repoPath) return;
    const latest = commits?.find((commit) => !commit.working && commit.stashIndex === undefined);
    if (latest) {
      setSelectedHash(latest.hash);
      initializedRepo.current = repoPath;
    }
  }, [repoPath, commits]);

  // The working-tree row isn't a real commit — selecting it highlights the row
  // but leaves the panel on the staging view (a null selection), so it's
  // excluded from what counts as the selected commit.
  const selectedCommit =
    commits?.find((commit) => commit.hash === selectedHash && !commit.working) ?? null;

  // Clicking the selected row again clears it, returning to the working view.
  const toggleSelect = (hash: string) =>
    setSelectedHash((prev) => (prev === hash ? null : hash));

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
    if (tip) setSelectedHash(tip.hash);
  };

  // Stashes carry no ref decoration, so they're matched by their stash index
  // (the `stashIndex` on the woven-in stash rows) rather than by a ref label.
  const selectStash = (index: number) => {
    const row = commits?.find((commit) => commit.stashIndex === index);
    if (row) setSelectedHash(row.hash);
  };

  return (
    <div className="repo-columns">
      <div className="repo-column repo-column-left" style={{ width: leftWidth }}>
        <RepoSidebar
          refs={refs}
          onSelectRef={selectRefTip}
          onSelectStash={selectStash}
          onCheckout={onCheckout}
          onStashPop={onStashPop}
          onStashDrop={onStashDrop}
          onGitflowStart={onGitflowStart}
          onGitflowFinish={onGitflowFinish}
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
          />
        ) : (
          <CommitList
            commits={commits}
            selectedHash={selectedHash}
            remotes={refs?.remotes}
            workingStatus={workingStatus}
            commitMessage={commitMessage}
            onCommitMessageChange={onCommitMessageChange}
            loadingMore={loadingMore}
            onSelect={toggleSelect}
            onCheckout={onCheckout}
          />
        )}
      </div>

      <ResizeHandle side="right" aria-label="Resize commit panel" onPointerDown={startResize('right')} />

      <div className="repo-column repo-column-right" style={{ width: rightWidth }}>
        <CommitPanel
          commit={selectedCommit}
          repoPath={repoPath}
          branch={branch}
          workingStatus={workingStatus}
          onWorkingStatusChange={onWorkingStatusChange}
          commitMessage={commitMessage}
          onCommitMessageChange={onCommitMessageChange}
          onCommitted={onCommitted}
          onViewWorking={() => setSelectedHash(commits?.[0]?.hash ?? null)}
          onSelectCommit={setSelectedHash}
          onOpenDiff={setDiffTarget}
          activeDiff={diffTarget}
          onError={onError}
        />
      </div>
    </div>
  );
}
