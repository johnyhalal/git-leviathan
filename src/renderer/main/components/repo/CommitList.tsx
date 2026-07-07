import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
} from 'react';
import type {
  CommitLogEntry,
  CommitRefDecoration,
  FileStatus,
  RemoteInfo,
  WorkingStatus,
} from '../../../../types/ipc';
import { CheckIcon, LocalIcon, MinusIcon, PencilIcon, PlusIcon, TagIcon } from '../../../../../assets/icons';
import { RemoteAvatar } from './RemoteAvatar';
import { CommitGraph, graphCellWidth } from './CommitGraph';
import { computeGraph, GRAPH_COLORS, type GraphNode } from './graph';
import {
  COMMIT_COLUMNS,
  useCommitColumns,
  type CommitColumnDef,
  type CommitColumnKey,
} from './useCommitColumns';

const ROW_HEIGHT = 28;

/** Fallback for the working row's message handler when none is supplied. */
const noop = () => undefined;

const COLUMN_META = Object.fromEntries(
  COMMIT_COLUMNS.map((c) => [c.key, c]),
) as Record<CommitColumnKey, CommitColumnDef>;

/**
 * How the Date column renders. Tweak these to change the format everywhere:
 * `DATE_FORMAT`/`TIME_FORMAT` are `Intl.DateTimeFormat` option sets (pass `null`
 * to a part to omit it) and `DATE_SEPARATOR` joins them. Locale is the system
 * default (`undefined`).
 */
const DATE_FORMAT: Intl.DateTimeFormatOptions | null = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};
const TIME_FORMAT: Intl.DateTimeFormatOptions | null = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};
const DATE_SEPARATOR = ' · ';

const dateFmt = DATE_FORMAT && new Intl.DateTimeFormat(undefined, DATE_FORMAT);
const timeFmt = TIME_FORMAT && new Intl.DateTimeFormat(undefined, TIME_FORMAT);

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return [dateFmt?.format(date), timeFmt?.format(date)]
    .filter(Boolean)
    .join(DATE_SEPARATOR);
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

/** Per-status file tallies for the working-tree row's icon group. */
interface ChangeCounts {
  modified: number;
  added: number;
  deleted: number;
}

/**
 * Tally working-tree changes by kind for the inline counters. A path that's both
 * staged and unstaged (partially staged) counts once, with its staged status
 * winning; renames fold into the "modified" bucket.
 */
function changeCounts(status: WorkingStatus | null): ChangeCounts {
  const byPath = new Map<string, FileStatus>();
  for (const file of status?.staged ?? []) byPath.set(file.path, file.status);
  for (const file of status?.unstaged ?? []) {
    if (!byPath.has(file.path)) byPath.set(file.path, file.status);
  }
  const counts: ChangeCounts = { modified: 0, added: 0, deleted: 0 };
  for (const kind of byPath.values()) {
    if (kind === 'added') counts.added++;
    else if (kind === 'deleted') counts.deleted++;
    else counts.modified++;
  }
  return counts;
}

/** A branch (local and/or remote) or tag, collapsed from raw ref decorations. */
interface RefGroup {
  key: string;
  /** Display name — basename only, e.g. `origin/main` contributes `main`. */
  name: string;
  kind: 'branch' | 'tag';
  /** The checked-out branch (or a detached HEAD). */
  isHead: boolean;
  /** A local branch of this name exists. */
  local: boolean;
  /** A remote-tracking branch of this name exists. */
  remote: boolean;
  /** The remote it tracks (`origin`, …), when remote — for the avatar. */
  remoteName?: string;
}

/** Strip the remote name from a remote-tracking ref: `origin/main` → `main`. */
function stripRemote(label: string): string {
  const slash = label.indexOf('/');
  return slash === -1 ? label : label.slice(slash + 1);
}

/**
 * Collapse a commit's raw ref decorations into display groups: a local branch
 * and its matching remote-tracking branch merge into one badge (basename only)
 * that records whether the branch is local, remote, or both. Tags and a detached
 * HEAD stay as their own badges. Encounter order is preserved.
 */
function groupRefs(refs: CommitRefDecoration[]): RefGroup[] {
  const groups: RefGroup[] = [];
  const byName = new Map<string, RefGroup>();

  const branchGroup = (name: string): RefGroup => {
    let group = byName.get(name);
    if (!group) {
      group = {
        key: `branch:${name}`,
        name,
        kind: 'branch',
        isHead: false,
        local: false,
        remote: false,
      };
      byName.set(name, group);
      groups.push(group);
    }
    return group;
  };

  for (const ref of refs) {
    switch (ref.kind) {
      case 'head':
        if (ref.label === 'HEAD') {
          // Detached HEAD — no branch name to group under.
          groups.push({
            key: 'head:detached',
            name: 'HEAD',
            kind: 'branch',
            isHead: true,
            local: false,
            remote: false,
          });
        } else {
          const group = branchGroup(ref.label);
          group.isHead = true;
          group.local = true;
        }
        break;
      case 'branch':
        branchGroup(ref.label).local = true;
        break;
      case 'remote': {
        const group = branchGroup(stripRemote(ref.label));
        group.remote = true;
        // `origin/main` → `origin`; keep the first remote seen for the avatar.
        const slash = ref.label.indexOf('/');
        if (slash !== -1) group.remoteName ??= ref.label.slice(0, slash);
        break;
      }
      case 'tag':
        groups.push({
          key: `tag:${ref.label}`,
          name: ref.label,
          kind: 'tag',
          isHead: false,
          local: false,
          remote: false,
        });
        break;
    }
  }
  return groups;
}

/** Human-readable location suffix for a group's tooltip. */
function refWhere(group: RefGroup): string {
  if (group.kind === 'tag') return 'tag';
  if (group.local && group.remote) return 'local & remote';
  if (group.remote) return 'remote';
  if (group.isHead && !group.local) return 'detached HEAD';
  return 'local';
}

/**
 * Append an alpha channel to a `#rrggbb` hex: the checked-out (HEAD) branch gets
 * 80% (`cc`) so it stands out, every other branch 40% (`66`).
 */
function badgeAlpha(hex: string, isHead: boolean): string {
  return `${hex}${isHead ? 'aa' : '44'}`;
}

/**
 * `color` is the row's graph-lane color, used as the badge background.
 * `remoteUrl` is the fetch URL of the branch's remote, for badging with its host
 * avatar. `onCheckout` checks the branch out (double-click).
 */
function RefBadge({
  group,
  color,
  remoteUrl,
  onCheckout,
}: {
  group: RefGroup;
  color: string;
  remoteUrl?: string;
  onCheckout?: (branch: string, remote?: string) => void;
}) {
  const classes = ['commit-ref-badge'];
  if (group.kind === 'tag') classes.push('commit-ref-tag');
  else if (group.isHead) classes.push('commit-ref-head');
  else if (group.local && group.remote) classes.push('commit-ref-both');
  else if (group.remote) classes.push('commit-ref-remote');
  else classes.push('commit-ref-branch');

  // A branch that isn't already checked out can be checked out by double-click:
  // a local branch by name, a remote-only one off its remote (creating a tracker).
  const checkoutable = group.kind === 'branch' && !group.isHead && (group.local || group.remote);
  if (checkoutable) classes.push('is-checkoutable');

  const handleDoubleClick = (event: MouseEvent) => {
    if (!checkoutable || !onCheckout) return;
    event.stopPropagation();
    if (group.local) onCheckout(group.name);
    else onCheckout(group.name, group.remoteName);
  };

  return (
    <span
      className={classes.join(' ')}
      // Tie the badge to its branch's graph lane: a translucent lane color,
      // more opaque for the checked-out branch. Exposed as a var so the hover
      // overlay can composite it over an opaque surface (see app.css).
      style={{ '--ref-bg': badgeAlpha(color, group.isHead) } as CSSProperties}
      title={
        checkoutable ? `Double-click to check out ${group.name}` : `${group.name} — ${refWhere(group)}`
      }
      onDoubleClick={handleDoubleClick}
    >
      {group.isHead && (
        <span className="commit-ref-icons">
          <CheckIcon size={11} />
        </span>
      )}
      <span className="commit-ref-name">{group.name}</span>
      <span className="commit-ref-icons commit-ref-icons-trailing">
        {group.kind === 'tag' ? (
            <TagIcon size={11} />
        ) : (
            <>
              {(group.local || !group.remote) && <LocalIcon size={11} />}
              {group.remote && <RemoteAvatar url={remoteUrl} size={11} />}
            </>
        )}
      </span>
    </span>
  );
}

interface CommitListProps {
  /** Commits newest-first, or null while loading. */
  commits: CommitLogEntry[] | null;
  selectedHash: string | null;
  /** Configured remotes, for badging remote refs with their host avatar. */
  remotes?: RemoteInfo[];
  /** Working-tree status, for the working row's file-count icon group. */
  workingStatus?: WorkingStatus | null;
  /** Shared commit message, edited inline on the working row. */
  commitMessage?: string;
  /** Update the shared commit message (mirrors the commit panel's textarea). */
  onCommitMessageChange?: (message: string) => void;
  /** Whether another page of history is being fetched (shows a footer note). */
  loadingMore?: boolean;
  onSelect: (hash: string) => void;
  /** Check out a branch by double-clicking its ref badge. */
  onCheckout?: (branch: string, remote?: string) => void;
}

/** Context passed to each column's cell renderer for a single row. */
interface CellContext {
  commit: CommitLogEntry;
  graph: GraphNode;
  maxLane: number;
  /** Remote name → fetch URL, for resolving a remote badge's avatar. */
  urlByRemote: Map<string, string>;
  /** Check out a branch by double-clicking its ref badge. */
  onCheckout?: (branch: string, remote?: string) => void;
  /** Live commit message + change tallies, for the working-tree row's cell. */
  working: {
    message: string;
    onMessageChange: (message: string) => void;
    counts: ChangeCounts;
    /** Whether the working row is the selected one. */
    selected: boolean;
    /** Select the working row (used when its input gains focus). */
    onSelect: () => void;
  };
}

/** The message cell of the synthetic working-tree row: inline `//WIP` input plus
 * a modified/added/deleted icon-count group. */
function WorkingMessageCell({ working }: { working: CellContext['working'] }) {
  const { message, onMessageChange, counts, selected, onSelect } = working;
  return (
    <td className="commit-message commit-message-working">
      <div className="commit-working-inner">
        <input
          type="text"
          className="commit-working-input"
          placeholder="//WIP"
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          // Focusing the field selects the working row (a single, non-toggling
          // selection); the click is swallowed so re-clicking to move the cursor
          // doesn't toggle that selection back off.
          onFocus={() => {
            if (!selected) onSelect();
          }}
          onClick={(event) => event.stopPropagation()}
        />
        <span className="commit-working-counts" aria-hidden="true">
          {counts.modified > 0 && (
            <span className="commit-working-count commit-working-modified" title="Modified files">
              <PencilIcon size={12} />
              {counts.modified}
            </span>
          )}
          {counts.added > 0 && (
            <span className="commit-working-count commit-working-added" title="Added files">
              <PlusIcon size={12} />
              {counts.added}
            </span>
          )}
          {counts.deleted > 0 && (
            <span className="commit-working-count commit-working-deleted" title="Deleted files">
              <MinusIcon size={12} />
              {counts.deleted}
            </span>
          )}
        </span>
      </div>
    </td>
  );
}

/** Renders the `<td>` for a given column key. */
function renderCell(key: CommitColumnKey, ctx: CellContext) {
  const { commit } = ctx;
  switch (key) {
    case 'refs': {
      // The commit sits on this graph node, so its refs adopt the node's lane color.
      const laneColor = GRAPH_COLORS[ctx.graph.color] ?? GRAPH_COLORS[0];
      return (
        <td key={key} className="commit-refs">
          <div className="commit-refs-inner">
            {groupRefs(commit.refs).map((group) => (
              <RefBadge
                key={group.key}
                group={group}
                color={laneColor}
                remoteUrl={group.remoteName ? ctx.urlByRemote.get(group.remoteName) : undefined}
                onCheckout={ctx.onCheckout}
              />
            ))}
          </div>
        </td>
      );
    }
    case 'graph':
      return (
        <td key={key} className="commit-graph-cell">
          <CommitGraph
            graph={ctx.graph}
            rowHeight={ROW_HEIGHT}
            maxLane={ctx.maxLane}
            avatarUrl={commit.authorAvatarUrl}
            merge={commit.parents.length > 1}
            nodeId={commit.hash}
          />
        </td>
      );
    case 'message':
      if (commit.working) return <WorkingMessageCell key={key} working={ctx.working} />;
      return (
        <td key={key} className="commit-message" title={commit.subject}>
          {commit.subject}
        </td>
      );
    case 'date':
      return (
        <td key={key} className="commit-date">
          {formatDate(commit.date)}
        </td>
      );
    case 'author':
      return (
        <td key={key} className="commit-author">
          {commit.author}
        </td>
      );
  }
}

export function CommitList({
  commits,
  selectedHash,
  remotes,
  workingStatus,
  commitMessage = '',
  onCommitMessageChange,
  loadingMore = false,
  onSelect,
  onCheckout,
}: CommitListProps) {
  const graph = useMemo(() => computeGraph(commits ?? []), [commits]);
  const maxLane = useMemo(() => maxLaneOf(graph), [graph]);
  const urlByRemote = useMemo(
    () => new Map((remotes ?? []).map((r) => [r.name, r.url])),
    [remotes],
  );
  const counts = useMemo(() => changeCounts(workingStatus ?? null), [workingStatus]);
  const { order, widths, startResize, moveColumn } = useCommitColumns();

  // Reorder drag feedback: the column being dragged and the header it's hovering,
  // with which side of that header the drop would land on.
  const [dragKey, setDragKey] = useState<CommitColumnKey | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    key: CommitColumnKey;
    side: 'before' | 'after';
  } | null>(null);

  // Scroll the selected row to the middle of the viewport when the selection
  // changes from *outside* the list (e.g. picking a branch in the sidebar).
  // Clicking a row here shouldn't recenter it — that row is already visible —
  // so an in-list click sets this flag to skip the next auto-scroll.
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null);
  const skipScrollRef = useRef(false);
  useEffect(() => {
    const skip = skipScrollRef.current;
    skipScrollRef.current = false;
    if (skip) return;
    if (selectedHash) {
      selectedRowRef.current?.scrollIntoView({ block: 'center' });
    }
  }, [selectedHash]);

  const handleSelect = (hash: string) => {
    skipScrollRef.current = true;
    onSelect(hash);
  };

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
  const colWidth = (key: CommitColumnKey): number | undefined => {
    if (key === 'graph') return graphWidth;
    // The message column carries no width so it absorbs the leftover space.
    if (key === 'message') return undefined;
    return widths[key];
  };

  const handleDragStart = (key: CommitColumnKey) => (event: DragEvent) => {
    setDragKey(key);
    event.dataTransfer.effectAllowed = 'move';
    // Firefox needs data set for a drag to start at all.
    event.dataTransfer.setData('text/plain', key);
  };

  const handleDragOver = (key: CommitColumnKey) => (event: DragEvent) => {
    if (!dragKey || dragKey === key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    setDropTarget((prev) =>
      prev?.key === key && prev.side === side ? prev : { key, side },
    );
  };

  const handleDrop = (key: CommitColumnKey) => (event: DragEvent) => {
    event.preventDefault();
    const side =
      dropTarget?.key === key ? dropTarget.side : 'before';
    if (dragKey) moveColumn(dragKey, key, side);
    setDragKey(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDragKey(null);
    setDropTarget(null);
  };

  return (
    <table className="commit-table" aria-label="Commit history">
      {/* Fixed layout keeps columns aligned across every row and lets long
          cells clip with an ellipsis instead of pushing neighbours. */}
      <colgroup>
        {order.map((key) => (
          <col key={key} style={{ width: colWidth(key) }} />
        ))}
      </colgroup>
      <thead>
        <tr className="commit-head">
          {order.map((key) => {
            const meta = COLUMN_META[key];
            const classes = ['commit-th'];
            if (dragKey === key) classes.push('is-dragging');
            if (dropTarget?.key === key) {
              classes.push(dropTarget.side === 'before' ? 'drop-before' : 'drop-after');
            }
            return (
              <th
                key={key}
                scope="col"
                className={classes.join(' ')}
                draggable
                onDragStart={handleDragStart(key)}
                onDragOver={handleDragOver(key)}
                onDrop={handleDrop(key)}
                onDragEnd={handleDragEnd}
              >
                <span className="commit-th-label">{meta.label}</span>
                {meta.resizable && (
                  <span
                    className="commit-col-resize"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${meta.label} column`}
                    // Don't let the grip initiate the header's reorder drag.
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                    onPointerDown={startResize(key)}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {commits.map((commit, index) => {
          const isStash = commit.stashIndex !== undefined;
          const classes = ['commit-row'];
          if (commit.hash === selectedHash) classes.push('is-selected');
          if (isStash) classes.push('is-stash');
          const ctx: CellContext = {
            commit,
            graph: graph[index],
            maxLane,
            urlByRemote,
            onCheckout,
            working: {
              message: commitMessage,
              onMessageChange: onCommitMessageChange ?? noop,
              counts,
              selected: commit.hash === selectedHash,
              onSelect: () => handleSelect(commit.hash),
            },
          };
          return (
            <tr
              key={commit.hash}
              ref={commit.hash === selectedHash ? selectedRowRef : undefined}
              className={classes.join(' ')}
              style={{ height: ROW_HEIGHT }}
              aria-selected={commit.hash === selectedHash}
              onClick={() => handleSelect(commit.hash)}
            >
              {order.map((key) => renderCell(key, ctx))}
            </tr>
          );
        })}
        {loadingMore && (
          <tr className="commit-loading-row" aria-hidden>
            <td colSpan={order.length}>Loading more…</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
