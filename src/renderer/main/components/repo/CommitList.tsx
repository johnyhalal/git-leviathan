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
import { BranchContextMenu, type BranchMenuTarget } from './BranchContextMenu';
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

/**
 * The branch delete targets a commit's refs carry: every branch group on the
 * commit (tags excluded) mapped to a {@link BranchMenuTarget}. Right-clicking
 * anywhere on the row opens the delete menu built from these, so the whole line
 * is a target — not just the badge. Groups with no delete action (the checked-out
 * branch, a detached HEAD) simply contribute no menu items.
 */
function branchTargets(refs: CommitRefDecoration[]): BranchMenuTarget[] {
  return groupRefs(refs)
    .filter((group) => group.kind === 'branch')
    .map((group) => ({
      name: group.name,
      local: group.local,
      isCurrent: group.isHead,
      remote: group.remote,
      remoteName: group.remoteName,
    }));
}

/** Whether a target has any available delete action (local and/or remote). */
function isDeletable(target: BranchMenuTarget): boolean {
  return (target.local && !target.isCurrent) || (target.remote && !!target.remoteName);
}

/**
 * The branch a commit's own decorations name, for lane labelling: the checked-out
 * branch wins, then any local branch, then any branch at all. Undefined when the
 * commit carries no branch (only tags, or nothing).
 */
function ownBranchName(refs: CommitRefDecoration[]): string | undefined {
  const groups = groupRefs(refs);
  return (
    groups.find((group) => group.kind === 'branch' && group.isHead)?.name ??
    groups.find((group) => group.kind === 'branch' && group.local)?.name ??
    groups.find((group) => group.kind === 'branch')?.name
  );
}

/**
 * Map every commit hash to the branch its lane belongs to. A branch label is
 * seeded at its tip and propagated down to its parents, so a commit with no ref
 * of its own still knows which branch it sits under. The first parent (the
 * lineage the graph keeps in one lane) is claimed first; merge parents inherit
 * the same label too, so a merged-in branch with no surviving ref still shows a
 * ghost. The topmost (newest) claimant of a shared ancestor wins, and a commit's
 * own branch always overrides an inherited one. Newest-first order (children
 * before parents) makes this a single top-down pass.
 */
function laneBranchByHash(commits: CommitLogEntry[]): Map<string, string> {
  const byHash = new Map<string, string>();
  for (const commit of commits) {
    if (commit.working || commit.stashIndex !== undefined) continue;
    const name = ownBranchName(commit.refs) ?? byHash.get(commit.hash);
    if (!name) continue;
    byHash.set(commit.hash, name);
    // parents[0] first so the first-parent lineage takes precedence, then merge
    // parents pick up the label only if nothing nearer has already claimed them.
    for (const parent of commit.parents) {
      if (!byHash.has(parent)) byHash.set(parent, name);
    }
  }
  return byHash;
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
  dnd,
  ghost = false,
}: {
  group: RefGroup;
  color: string;
  remoteUrl?: string;
  onCheckout?: (branch: string, remote?: string) => void;
  /** Branch drag-and-drop plumbing; absent disables merge/rebase dragging. */
  dnd?: BranchDnd;
  /** A hover-revealed placeholder for the commit's lane branch, not a real ref:
   *  it looks like a local-branch badge but takes part in no interaction. */
  ghost?: boolean;
}) {
  // Whether the badge is highlighted as the drop target under the cursor mid-drag.
  const [dropHover, setDropHover] = useState(false);

  const classes = ['commit-ref-badge'];
  if (ghost) classes.push('commit-ref-ghost');
  if (group.kind === 'tag') classes.push('commit-ref-tag');
  else if (group.isHead) classes.push('commit-ref-head');
  else if (group.local && group.remote) classes.push('commit-ref-both');
  else if (group.remote) classes.push('commit-ref-remote');
  else classes.push('commit-ref-branch');

  // A branch that isn't already checked out can be checked out by double-click:
  // a local branch by name, a remote-only one off its remote (creating a tracker).
  // A ghost placeholder is inert — it's not a real ref to act on.
  const checkoutable =
    !ghost && group.kind === 'branch' && !group.isHead && (group.local || group.remote);
  if (checkoutable) classes.push('is-checkoutable');

  // Only local branches take part in merge/rebase dragging: they're what git can
  // check out and merge/rebase into. A local branch can be dragged as the source,
  // and is a valid drop target for any *other* local branch being dragged.
  const isLocalBranch = !ghost && group.kind === 'branch' && group.local;
  const draggable = isLocalBranch && !!dnd;
  const isDropTarget =
    isLocalBranch && !!dnd && dnd.dragSource !== null && dnd.dragSource !== group.name;
  if (draggable) classes.push('is-branch-draggable');
  if (isDropTarget && dropHover) classes.push('is-drop-target');

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
      draggable={draggable}
      onDragStart={
        draggable
          ? (event) => {
              // Don't let the drag bubble to the row (row-level handlers, text drag).
              event.stopPropagation();
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', group.name);
              dnd.onDragStart(group.name);
            }
          : undefined
      }
      onDragEnd={draggable ? () => dnd.onDragEnd() : undefined}
      onDragEnter={
        isDropTarget
          ? (event) => {
              event.preventDefault();
              setDropHover(true);
            }
          : undefined
      }
      onDragOver={
        isDropTarget
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }
          : undefined
      }
      onDragLeave={isDropTarget ? () => setDropHover(false) : undefined}
      onDrop={
        isDropTarget
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              setDropHover(false);
              dnd.onDrop(group.name, event.clientX, event.clientY);
            }
          : undefined
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
  /** Whether to show the inline "new branch" input in the HEAD commit's refs cell. */
  creatingBranch?: boolean;
  /** Create a branch at HEAD with the entered name (Enter in the inline input). */
  onCreateBranch?: (name: string) => void;
  /** Dismiss the inline "new branch" input without creating (Escape / blur). */
  onCancelCreateBranch?: () => void;
  /** Merge the dragged branch into the one it was dropped on. */
  onMergeBranch?: (source: string, target: string) => void;
  /** Rebase the dragged branch into the one it was dropped on. */
  onRebaseBranch?: (source: string, target: string) => void;
  /** Delete a local branch (`git branch -D`), from a badge's context menu. */
  onDeleteBranch?: (branch: string) => void;
  /** Delete a branch on its remote (`git push <remote> --delete`). */
  onDeleteRemoteBranch?: (remote: string, branch: string) => void;
}

/**
 * Drag-and-drop plumbing shared by the branch badges: `dragSource` is the branch
 * currently being dragged (null when idle), the callbacks start/end a drag and
 * finish a drop of `dragSource` onto another badge's `target` at screen (x, y).
 */
interface BranchDnd {
  dragSource: string | null;
  onDragStart: (branch: string) => void;
  onDragEnd: () => void;
  onDrop: (target: string, x: number, y: number) => void;
}

/** An open branch drop menu: merge/rebase `source` into `target`, anchored at (x, y). */
interface BranchMenu {
  source: string;
  target: string;
  x: number;
  y: number;
}

/**
 * The right-click-style menu that appears where a branch badge was dropped onto
 * another. Offers merging or rebasing the dragged branch into the drop target,
 * and dismisses on an outside click, Escape, or after a choice.
 */
function BranchDropMenu({
  menu,
  onMerge,
  onRebase,
  onClose,
}: {
  menu: BranchMenu;
  onMerge: (source: string, target: string) => void;
  onRebase: (source: string, target: string) => void;
  onClose: () => void;
}) {
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

  return (
    <div
      ref={ref}
      className="branch-drop-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
    >
      <button
        type="button"
        className="branch-drop-item"
        role="menuitem"
        onClick={() => {
          onMerge(menu.source, menu.target);
          onClose();
        }}
      >
        Merge <strong>{menu.source}</strong> into <strong>{menu.target}</strong>
      </button>
      <button
        type="button"
        className="branch-drop-item"
        role="menuitem"
        onClick={() => {
          onRebase(menu.source, menu.target);
          onClose();
        }}
      >
        Rebase <strong>{menu.source}</strong> into <strong>{menu.target}</strong>
      </button>
    </div>
  );
}

/** Context passed to each column's cell renderer for a single row. */
interface CellContext {
  commit: CommitLogEntry;
  graph: GraphNode;
  maxLane: number;
  /** Remote name → fetch URL, for resolving a remote badge's avatar. */
  urlByRemote: Map<string, string>;
  /** The branch this commit's lane belongs to (propagated from the tip), shown as
   *  a hover-revealed ghost badge when the commit carries no branch of its own. */
  laneBranch?: string;
  /** Check out a branch by double-clicking its ref badge. */
  onCheckout?: (branch: string, remote?: string) => void;
  /** Branch drag-and-drop plumbing for the ref badges (merge/rebase). */
  branchDnd?: BranchDnd;
  /**
   * The inline "new branch" input for the HEAD commit's refs cell, present only
   * on the HEAD row while branch creation is active; absent on every other row.
   */
  newBranch?: {
    onCreate: (name: string) => void;
    onCancel: () => void;
  };
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

/**
 * The inline branch-name field shown in the HEAD commit's refs cell. Autofocuses
 * on mount; Enter creates the branch, Escape or blur dismisses. The click is
 * swallowed so focusing the field doesn't also select the HEAD row.
 */
function NewBranchInput({
  onCreate,
  onCancel,
}: {
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <input
      ref={ref}
      type="text"
      className="commit-new-branch-input"
      placeholder="enter branch name"
      value={name}
      onChange={(event) => setName(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          const trimmed = name.trim();
          if (trimmed) onCreate(trimmed);
        } else if (event.key === 'Escape') {
          onCancel();
        }
      }}
      onBlur={onCancel}
    />
  );
}

/** Renders the `<td>` for a given column key. */
function renderCell(key: CommitColumnKey, ctx: CellContext) {
  const { commit } = ctx;
  switch (key) {
    case 'refs': {
      // While creating a branch, the input takes over the HEAD row's refs cell
      // in place of its badges — no room for both, and it reads as "name this".
      if (ctx.newBranch) {
        return (
          <td key={key} className="commit-refs">
            <div className="commit-refs-inner">
              <NewBranchInput
                onCreate={ctx.newBranch.onCreate}
                onCancel={ctx.newBranch.onCancel}
              />
            </div>
          </td>
        );
      }
      // The commit sits on this graph node, so its refs adopt the node's lane color.
      const laneColor = GRAPH_COLORS[ctx.graph.color] ?? GRAPH_COLORS[0];
      const groups = groupRefs(commit.refs);
      // Any commit carrying a ref (branch or tag) gets a horizontal leader line
      // from its badge across to the graph column, tying the label to its node.
      // The checked-out (HEAD) branch draws its line at full strength; every
      // other branch or tag line is dimmed.
      const hasRef = groups.length > 0;
      const isHead = groups.some((group) => group.isHead);
      // A commit with no ref at all shows a hover-revealed ghost of its lane's
      // branch — a dimmed placeholder that looks like a real badge — so every
      // row reads as belonging to some branch. A commit that already carries a
      // tag keeps just its tag, no ghost. Its own connector line rides along, so
      // the real one is skipped when the ghost is showing.
      const ghostBranch = !hasRef ? ctx.laneBranch : undefined;
      // With more than one ref, collapse to the first badge plus a `+N` counter;
      // hovering the cell reveals every ref wrapped over multiple lines (see the
      // `.has-overflow` rules in app.css).
      const overflow = groups.length - 1;
      return (
        <td key={key} className="commit-refs">
          <div className={`commit-refs-inner${overflow > 0 ? ' has-overflow' : ''}`}>
            {groups.map((group) => (
              <RefBadge
                key={group.key}
                group={group}
                color={laneColor}
                remoteUrl={group.remoteName ? ctx.urlByRemote.get(group.remoteName) : undefined}
                onCheckout={ctx.onCheckout}
                dnd={ctx.branchDnd}
              />
            ))}
            {overflow > 0 && (
              <span className="commit-ref-more" aria-hidden="true">
                +{overflow}
              </span>
            )}
            {ghostBranch && (
              <div className="commit-ref-ghost-line" style={{ '--ref-line': laneColor } as CSSProperties}>
                <RefBadge
                  group={{
                    key: `ghost:${ghostBranch}`,
                    name: ghostBranch,
                    kind: 'branch',
                    isHead: false,
                    local: true,
                    remote: false,
                  }}
                  color={laneColor}
                  ghost
                />
                <span className="commit-ref-connector is-ghost" aria-hidden="true" />
              </div>
            )}
            {hasRef && !ghostBranch && (
              <span
                className={`commit-ref-connector${isHead ? ' is-head' : ''}`}
                style={{ '--ref-line': laneColor } as CSSProperties}
                aria-hidden="true"
              />
            )}
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
          <div className="commit-cell-inset">{commit.subject}</div>
        </td>
      );
    case 'date':
      return (
        <td key={key} className="commit-date">
          <div className="commit-cell-inset">{formatDate(commit.date)}</div>
        </td>
      );
    case 'author':
      return (
        <td key={key} className="commit-author">
          <div className="commit-cell-inset">{commit.author}</div>
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
  creatingBranch = false,
  onCreateBranch,
  onCancelCreateBranch,
  onMergeBranch,
  onRebaseBranch,
  onDeleteBranch,
  onDeleteRemoteBranch,
}: CommitListProps) {
  const graph = useMemo(() => computeGraph(commits ?? []), [commits]);
  const maxLane = useMemo(() => maxLaneOf(graph), [graph]);
  const laneBranches = useMemo(() => laneBranchByHash(commits ?? []), [commits]);
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

  // Branch drag-and-drop: the branch badge currently being dragged, and the
  // merge/rebase menu opened where one branch was dropped onto another.
  const [dragBranch, setDragBranch] = useState<string | null>(null);
  const [branchMenu, setBranchMenu] = useState<BranchMenu | null>(null);
  // The branch delete menu opened by right-clicking a commit row, anchored at the
  // click point; null when closed. `targets` are every branch on that row, so the
  // menu lists each one's delete actions together.
  const [contextMenu, setContextMenu] = useState<{
    targets: BranchMenuTarget[];
    x: number;
    y: number;
  } | null>(null);
  const branchDnd = useMemo<BranchDnd>(
    () => ({
      dragSource: dragBranch,
      onDragStart: setDragBranch,
      onDragEnd: () => setDragBranch(null),
      onDrop: (target, x, y) => {
        if (dragBranch && dragBranch !== target) {
          setBranchMenu({ source: dragBranch, target, x, y });
        }
        setDragBranch(null);
      },
    }),
    [dragBranch],
  );

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
    <>
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
          // The inline "new branch" input rides on the checked-out (HEAD) commit's
          // refs cell while branch creation is active.
          const isHead = commit.refs.some((ref) => ref.kind === 'head');
          const newBranch =
            creatingBranch && isHead && onCreateBranch && onCancelCreateBranch
              ? { onCreate: onCreateBranch, onCancel: onCancelCreateBranch }
              : undefined;
          const ctx: CellContext = {
            commit,
            graph: graph[index],
            maxLane,
            urlByRemote,
            laneBranch: laneBranches.get(commit.hash),
            onCheckout,
            branchDnd,
            newBranch,
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
              // Right-click anywhere on the row opens the branch delete menu for
              // every branch on that commit — the whole line is the target, not
              // just the badge. Rows with no deletable branch keep the native menu.
              onContextMenu={(event) => {
                const targets = branchTargets(commit.refs).filter(isDeletable);
                if (targets.length === 0) return;
                event.preventDefault();
                setContextMenu({ targets, x: event.clientX, y: event.clientY });
              }}
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
    {branchMenu && (
      <BranchDropMenu
        menu={branchMenu}
        onMerge={(source, target) => onMergeBranch?.(source, target)}
        onRebase={(source, target) => onRebaseBranch?.(source, target)}
        onClose={() => setBranchMenu(null)}
      />
    )}
    {contextMenu && (
      <BranchContextMenu
        targets={contextMenu.targets}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu(null)}
        onDeleteBranch={(name) => onDeleteBranch?.(name)}
        onDeleteRemoteBranch={(remote, name) => onDeleteRemoteBranch?.(remote, name)}
      />
    )}
    </>
  );
}
