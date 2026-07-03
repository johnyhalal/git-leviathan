import { useMemo } from 'react';
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
  onSelect: (hash: string) => void;
}

export function CommitList({ commits, selectedHash, onSelect }: CommitListProps) {
  const graph = useMemo(() => computeGraph(commits ?? []), [commits]);
  const maxLane = useMemo(() => maxLaneOf(graph), [graph]);

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
        {commits.map((commit, index) => (
          <tr
            key={commit.hash}
            className={
              commit.hash === selectedHash ? 'commit-row is-selected' : 'commit-row'
            }
            style={{ height: ROW_HEIGHT }}
            aria-selected={commit.hash === selectedHash}
            onClick={() => onSelect(commit.hash)}
          >
            <td className="commit-refs">
              <div className="commit-refs-inner">
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
        ))}
      </tbody>
    </table>
  );
}
