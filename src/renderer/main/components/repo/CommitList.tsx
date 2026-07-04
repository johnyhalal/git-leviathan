import { useEffect, useMemo, useRef } from 'react';
import type { CommitLogEntry, CommitRefDecoration } from '../../../../types/ipc';
import { CommitGraph, graphCellWidth } from './CommitGraph';
import { computeGraph, type GraphNode } from './graph';

const ROW_HEIGHT = 28;

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${dateFmt.format(date)} · ${timeFmt.format(date)}`;
}

/** Highest lane index used by any row — sets the graph column width. */
function maxLaneOf(graph: GraphNode[]): number {
  let max = 0;
  for (const node of graph) {
    max = Math.max(max, node.node);
    for (const v of node.verticals ?? []) max = Math.max(max, v.lane);
    for (const c of node.in ?? []) max = Math.max(max, c.lane);
    for (const c of node.out ?? []) max = Math.max(max, c.lane);
  }
  return max;
}

function RefBadge({ refItem }: { refItem: CommitRefDecoration }) {
  return (
    <span className={`commit-ref-badge commit-ref-${refItem.kind}`}>
      {refItem.label}
    </span>
  );
}

interface CommitListProps {
  /** Commits newest-first, or null while loading. */
  commits: CommitLogEntry[] | null;
  selectedHash: string | null;
  /** Whether another page of history is being fetched (shows a footer note). */
  loadingMore?: boolean;
  onSelect: (hash: string) => void;
}

export function CommitList({
  commits,
  selectedHash,
  loadingMore = false,
  onSelect,
}: CommitListProps) {
  const graph = useMemo(() => computeGraph(commits ?? []), [commits]);
  const maxLane = useMemo(() => maxLaneOf(graph), [graph]);

  // Scroll the selected row to the middle of the viewport when the selection
  // changes (e.g. picking a branch in the sidebar).
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (selectedHash) {
      selectedRowRef.current?.scrollIntoView({ block: 'center' });
    }
  }, [selectedHash]);

  if (commits === null) {
    return (
      <div className="commit-empty">
        <p>Loading history…</p>
      </div>
    );
  }
  if (commits.length === 0) {
    return (
      <div className="commit-empty">
        <p>No commits to show.</p>
      </div>
    );
  }

  const graphWidth = graphCellWidth(maxLane);

  return (
    <table className="commit-table" aria-label="Commit history">
      {/* Fixed layout keeps columns aligned across every row and lets long
          cells clip with an ellipsis instead of pushing neighbours. */}
      <colgroup>
        <col className="commit-col-refs" />
        <col style={{ width: graphWidth }} />
        <col className="commit-col-message" />
        <col className="commit-col-date" />
        <col className="commit-col-author" />
      </colgroup>
      <thead>
        <tr className="commit-head">
          <th scope="col">Branch / Tag</th>
          <th scope="col">Graph</th>
          <th scope="col">Message</th>
          <th scope="col">Date</th>
          <th scope="col">Author</th>
        </tr>
      </thead>
      <tbody>
        {commits.map((commit, index) => {
          const isStash = commit.stashIndex !== undefined;
          const classes = ['commit-row'];
          if (commit.hash === selectedHash) classes.push('is-selected');
          if (isStash) classes.push('is-stash');
          return (
          <tr
            key={commit.hash}
            ref={commit.hash === selectedHash ? selectedRowRef : undefined}
            className={classes.join(' ')}
            style={{ height: ROW_HEIGHT }}
            aria-selected={commit.hash === selectedHash}
            onClick={() => onSelect(commit.hash)}
          >
            <td className="commit-refs">
              <div className="commit-refs-inner">
                {isStash && (
                  <span className="commit-ref-badge commit-ref-stash">
                    stash@{`{${commit.stashIndex}}`}
                  </span>
                )}
                {commit.refs.map((refItem) => (
                  <RefBadge key={refItem.label} refItem={refItem} />
                ))}
              </div>
            </td>
            <td className="commit-graph-cell">
              <CommitGraph
                graph={graph[index]}
                rowHeight={ROW_HEIGHT}
                maxLane={maxLane}
                avatarUrl={commit.authorAvatarUrl}
                nodeId={commit.hash}
              />
            </td>
            <td className="commit-message" title={commit.subject}>
              {commit.subject}
            </td>
            <td className="commit-date">{formatDate(commit.date)}</td>
            <td className="commit-author">{commit.author}</td>
          </tr>
          );
        })}
        {loadingMore && (
          <tr className="commit-loading-row" aria-hidden>
            <td colSpan={5}>Loading more…</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
