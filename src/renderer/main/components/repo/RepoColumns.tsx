import { useState } from 'react';
import type {
  CommitLogEntry,
  GitflowKind,
  RepoRefs,
} from '../../../../types/ipc';
import { RepoSidebar } from './RepoSidebar';
import { CommitList } from './CommitList';
import { CommitPanel } from './CommitPanel';
import { ResizeHandle } from './ResizeHandle';
import { useResizableColumns } from './useResizableColumns';

interface RepoColumnsProps {
  repoPath: string;
  refs: RepoRefs | null;
  commits: CommitLogEntry[] | null;
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
  refs,
  commits,
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

  const selectedCommit =
    commits?.find((commit) => commit.hash === selectedHash) ?? null;

  // Clicking the selected row again clears it, returning to the working view.
  const toggleSelect = (hash: string) =>
    setSelectedHash((prev) => (prev === hash ? null : hash));

  return (
    <div className="repo-columns">
      <div className="repo-column repo-column-left" style={{ width: leftWidth }}>
        <RepoSidebar
          refs={refs}
          onCheckout={onCheckout}
          onStashPop={onStashPop}
          onStashDrop={onStashDrop}
          onGitflowStart={onGitflowStart}
          onGitflowFinish={onGitflowFinish}
        />
      </div>

      <ResizeHandle aria-label="Resize sidebar" onPointerDown={startResize('left')} />

      <div className="repo-column repo-column-center">
        <CommitList
          commits={commits}
          selectedHash={selectedHash}
          onSelect={toggleSelect}
        />
      </div>

      <ResizeHandle aria-label="Resize commit panel" onPointerDown={startResize('right')} />

      <div className="repo-column repo-column-right" style={{ width: rightWidth }}>
        <CommitPanel
          commit={selectedCommit}
          repoPath={repoPath}
          onCommitted={onCommitted}
          onError={onError}
        />
      </div>
    </div>
  );
}
