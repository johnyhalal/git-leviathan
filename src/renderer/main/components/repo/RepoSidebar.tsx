import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  BranchIcon,
  CheckIcon,
  FolderIcon,
  GitflowIcon,
  LocalIcon,
  MoreIcon,
  PlusIcon,
  RemoteIcon,
  PullRequestIcon,
  TrayIcon,
  TagIcon,
  WorktreeIcon,
} from '../../../../../assets/icons';
import { RemoteAvatar } from './RemoteAvatar';
import { BranchContextMenu, type BranchMenuTarget } from './BranchContextMenu';
import { StashContextMenu, type StashMenuTarget } from './StashContextMenu';
import {
  WorktreeContextMenu,
  type WorktreeMenuTarget,
} from './WorktreeContextMenu';
import type {
  GitflowConfig,
  GitflowConfigResult,
  GitflowKind,
  IntegrationProvider,
  LocalBranchInfo,
  PullRequestListResult,
  PullRequestState,
  PullRequestSummary,
  RemoteBranchInfo,
  RepoRefs,
  StashInfo,
  TagInfo,
  WorktreeInfo,
} from '../../../../types/ipc';
import { CollapsibleSection } from './CollapsibleSection';
import { PullRequestDialog } from './PullRequestDialog';
import { NewPullRequestDialog } from './NewPullRequestDialog';
import { GitflowStartDialog } from './GitflowStartDialog';
import { GitflowSettingsDialog } from './GitflowSettingsDialog';
import { WorktreeDialog, type WorktreeBranchOption } from './WorktreeDialog';

const cx = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(' ');

const PROVIDER_LABEL: Record<IntegrationProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
};

/**
 * Rough client-side host detection, only to gate the sidebar's PR affordances
 * (the create button, the section hint). The main process does the real parse
 * when listing/creating.
 */
function providerOfUrl(url: string | null | undefined): IntegrationProvider | null {
  if (!url) return null;
  if (url.includes('github.com')) return 'github';
  if (url.includes('gitlab.com')) return 'gitlab';
  return null;
}

/** Left padding for a row at a given tree depth. */
const indent = (depth: number) => 24 + depth * 14;

// --- Path tree --------------------------------------------------------------

interface TreeLeaf<T> {
  kind: 'leaf';
  segment: string;
  full: string;
  item: T;
}
interface TreeFolderNode<T> {
  kind: 'folder';
  segment: string;
  path: string;
  children: TreeNode<T>[];
}
type TreeNode<T> = TreeLeaf<T> | TreeFolderNode<T>;

/** Split each item's slash-delimited name into a nested folder/leaf tree. */
function buildTree<T>(items: T[], getName: (item: T) => string): TreeNode<T>[] {
  const root: TreeFolderNode<T> = { kind: 'folder', segment: '', path: '', children: [] };

  for (const item of items) {
    const name = getName(item);
    const segments = name.split('/');
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const path = cursor.path ? `${cursor.path}/${segment}` : segment;
      let next = cursor.children.find(
        (node): node is TreeFolderNode<T> => node.kind === 'folder' && node.segment === segment,
      );
      if (!next) {
        next = { kind: 'folder', segment, path, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }
    cursor.children.push({ kind: 'leaf', segment: segments[segments.length - 1], full: name, item });
  }

  // Flat alphabetical: folders and leaves intermixed, sorted by name.
  const sort = (folder: TreeFolderNode<T>) => {
    folder.children.sort((a, b) =>
      a.segment.localeCompare(b.segment, undefined, { sensitivity: 'base' }),
    );
    for (const child of folder.children) if (child.kind === 'folder') sort(child);
  };
  sort(root);

  return root.children;
}

interface TreeFolderProps {
  name: string;
  depth: number;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** A collapsible folder row with a rotating caret and indented children. */
function TreeFolder({ name, depth, icon, defaultOpen = true, children }: TreeFolderProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="repo-tree-folder">
      <button
        type="button"
        className="repo-tree-folder-header"
        style={{ paddingLeft: indent(depth) }}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {icon ?? <FolderIcon size={14} />}
        <span className="repo-tree-folder-name">{name}</span>
      </button>
      {open && children}
    </div>
  );
}

interface BranchTreeProps<T> {
  nodes: TreeNode<T>[];
  depth: number;
  renderLeaf: (item: T, leaf: string, depth: number) => ReactNode;
}

/** Renders a built tree: folders recurse, leaves defer to `renderLeaf`. */
function BranchTree<T>({ nodes, depth, renderLeaf }: BranchTreeProps<T>) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === 'folder' ? (
          <TreeFolder key={`f:${node.path}`} name={node.segment} depth={depth}>
            <BranchTree nodes={node.children} depth={depth + 1} renderLeaf={renderLeaf} />
          </TreeFolder>
        ) : (
          <Fragment key={`l:${node.full}`}>{renderLeaf(node.item, node.segment, depth)}</Fragment>
        ),
      )}
    </>
  );
}

// --- Rows -------------------------------------------------------------------

const PR_STATE_LABEL: Record<PullRequestState, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

interface RowProps {
  id: string;
  active: string | null;
  onSelect: (id: string) => void;
}

function LocalBranchRow({
  branch,
  label,
  depth,
  id,
  active,
  onSelect,
  onCheckout,
  onOpenMenu,
}: RowProps & {
  branch: LocalBranchInfo;
  label: string;
  depth: number;
  onCheckout: (branch: string) => void;
  onOpenMenu: (target: BranchMenuTarget, x: number, y: number) => void;
}) {
  const target: BranchMenuTarget = {
    name: branch.name,
    local: true,
    isCurrent: branch.current,
    remote: false,
  };
  return (
    <div
      className={cx('repo-list-item', active === id && 'is-active', branch.current && 'is-current')}
      style={{ paddingLeft: indent(depth) }}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(target, event.clientX, event.clientY);
      }}
    >
      {branch.current && (
        <span
          className="repo-branch-check"
          aria-label="Current branch"
        >
          <CheckIcon size={14} />
        </span>
      )}
      <button
        type="button"
        className="repo-row-main tooltip-host"
        aria-current={branch.current ? 'true' : undefined}
        onClick={() => onSelect(id)}
        onDoubleClick={() => {
          if (!branch.current) onCheckout(branch.name);
        }}
        data-tooltip={`Double-click to check out ${branch.name}`}
      >
        <BranchIcon size={14} />
        <span className="repo-list-label tooltip-host" data-tooltip={branch.name}>
          {label}
        </span>
        {(branch.ahead > 0 || branch.behind > 0) && (
          <span className="repo-branch-track">
            {branch.ahead ? <span>↑{branch.ahead}</span> : null}
            {branch.behind ? <span>↓{branch.behind}</span> : null}
          </span>
        )}
      </button>
      <button
        type="button"
        className="repo-row-action tooltip-host"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu(target, rect.right, rect.bottom);
        }}
        data-tooltip="Branch actions"
        aria-label="Branch actions"
      >
        <MoreIcon size={16} />
      </button>
    </div>
  );
}

function RemoteBranchRow({
  full,
  name,
  remote,
  label,
  depth,
  id,
  active,
  onSelect,
  onCheckout,
  onOpenMenu,
}: RowProps & {
  full: string;
  name: string;
  remote: string;
  label: string;
  depth: number;
  onCheckout: (branch: string, remote?: string) => void;
  onOpenMenu: (target: BranchMenuTarget, x: number, y: number) => void;
}) {
  const target: BranchMenuTarget = {
    name,
    local: false,
    isCurrent: false,
    remote: true,
    remoteName: remote,
  };
  return (
    <div
      className={cx('repo-list-item', active === id && 'is-active')}
      style={{ paddingLeft: indent(depth) }}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(target, event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        className="repo-row-main tooltip-host"
        onClick={() => onSelect(id)}
        onDoubleClick={() => onCheckout(name, remote)}
        data-tooltip={`Double-click to check out ${name}`}
      >
        <BranchIcon size={14} />
        <span className="repo-list-label tooltip-host" data-tooltip={full}>
          {label}
        </span>
      </button>
      <button
        type="button"
        className="repo-row-action tooltip-host"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu(target, rect.right, rect.bottom);
        }}
        data-tooltip="Branch actions"
        aria-label="Branch actions"
      >
        <MoreIcon size={16} />
      </button>
    </div>
  );
}

function PullRequestRow({
  pr,
  id,
  active,
  onSelect,
  onOpen,
}: RowProps & { pr: PullRequestSummary; onOpen: (pr: PullRequestSummary) => void }) {
  return (
    <button
      type="button"
      className={cx('repo-list-item', 'tooltip-host', active === id && 'is-active')}
      style={{ paddingLeft: indent(0) }}
      onClick={() => {
        onSelect(id);
        onOpen(pr);
      }}
      data-tooltip={pr.title}
    >
      <span className={cx('repo-pr-icon', `pr-state-${pr.state}`)}>
        <PullRequestIcon size={14} />
      </span>
      <span className="repo-pr-number">#{pr.number}</span>
      <span className="repo-list-label tooltip-host" data-tooltip={pr.title}>
        {pr.title}
      </span>
      <span className={cx('repo-pr-state', `pr-state-${pr.state}`)}>
        {PR_STATE_LABEL[pr.state]}
      </span>
    </button>
  );
}

function TagRow({ tag, id, active, onSelect }: RowProps & { tag: TagInfo }) {
  return (
    <button
      type="button"
      className={cx('repo-list-item', active === id && 'is-active')}
      style={{ paddingLeft: indent(0) }}
      onClick={() => onSelect(id)}
    >
      <TagIcon size={14} />
      <span className="repo-list-label tooltip-host" data-tooltip={tag.name}>
        {tag.name}
      </span>
    </button>
  );
}

function StashRow({
  stash,
  id,
  active,
  onSelect,
  onOpenMenu,
}: RowProps & {
  stash: StashInfo;
  /** Open the stash context menu at the right-click point. */
  onOpenMenu: (target: StashMenuTarget, x: number, y: number) => void;
}) {
  return (
    <div
      className={cx('repo-list-item', 'repo-stash-item', active === id && 'is-active')}
      style={{ paddingLeft: indent(0) }}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(
          { index: stash.index, message: stash.message },
          event.clientX,
          event.clientY,
        );
      }}
    >
      <button
        type="button"
        className="repo-row-main tooltip-host"
        onClick={() => onSelect(id)}
        data-tooltip={stash.branch ? `${stash.message} on: ${stash.branch}` : stash.message}
      >
        <TrayIcon size={14} />
        <span className="repo-list-label">
          {stash.message}
          {stash.branch && (
            <>
              {' on: '}
              <span className="repo-stash-branch">{stash.branch}</span>
            </>
          )}
        </span>
      </button>
      <button
        type="button"
        className="repo-row-action tooltip-host"
        // Anchor the menu at the button so a plain left-click opens the same
        // apply/pop/delete menu the right-click gesture does.
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu(
            { index: stash.index, message: stash.message },
            rect.right,
            rect.bottom,
          );
        }}
        data-tooltip="Stash actions"
        aria-label="Stash actions"
      >
        <MoreIcon size={16} />
      </button>
    </div>
  );
}

function WorktreeRow({
  worktree,
  id,
  active,
  onSelect,
  onOpen,
  onOpenMenu,
}: RowProps & {
  worktree: WorktreeInfo;
  /** Open the worktree's folder as a repository in a new tab. */
  onOpen: (path: string) => void;
  /** Open the worktree context menu at the given point. */
  onOpenMenu: (target: WorktreeMenuTarget, x: number, y: number) => void;
}) {
  const target: WorktreeMenuTarget = {
    path: worktree.path,
    branch: worktree.branch,
    isMain: worktree.isMain,
    isCurrent: worktree.isCurrent,
    locked: worktree.locked,
  };
  const detail = worktree.bare
    ? 'bare'
    : worktree.branch ?? (worktree.head ? `detached @ ${worktree.head}` : 'detached');
  // The menu offers open actions unless this is the current worktree, and
  // remove/lock unless it's the main one — so it's empty (and hidden) only for the
  // main worktree while it's the one open here.
  const hasMenu = !worktree.isCurrent || !worktree.isMain;
  return (
    <div
      className={cx(
        'repo-list-item',
        active === id && 'is-active',
        worktree.isCurrent && 'is-current',
      )}
      style={{ paddingLeft: indent(0) }}
      onContextMenu={(event) => {
        if (!hasMenu) return;
        event.preventDefault();
        onOpenMenu(target, event.clientX, event.clientY);
      }}
    >
      {worktree.isCurrent && (
        <span className="repo-branch-check" aria-label="Current worktree">
          <CheckIcon size={14} />
        </span>
      )}
      <button
        type="button"
        className="repo-row-main tooltip-host"
        aria-current={worktree.isCurrent ? 'true' : undefined}
        onClick={() => onSelect(id)}
        onDoubleClick={() => {
          if (!worktree.isCurrent) onOpen(worktree.path);
        }}
        data-tooltip={
          worktree.isCurrent
            ? worktree.path
            : `Double-click to open ${worktree.path} in a new tab`
        }
      >
        {/* The main worktree is the repository itself — a plain branch icon;
            linked worktrees get the tree icon. */}
        {worktree.isMain ? <BranchIcon size={14} /> : <WorktreeIcon size={14} />}
        <span className="repo-list-label">
          {detail}
          {worktree.locked && <span className="repo-worktree-locked"> (locked)</span>}
        </span>
      </button>
      {hasMenu && (
        <button
          type="button"
          className="repo-row-action tooltip-host"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenMenu(target, rect.right, rect.bottom);
          }}
          data-tooltip="Worktree actions"
          aria-label="Worktree actions"
        >
          <MoreIcon size={16} />
        </button>
      )}
    </div>
  );
}

// --- Sidebar ----------------------------------------------------------------

/**
 * One base-branch row in the Gitflow list: the configured main/develop branch,
 * resolved to whichever of local/remote it actually exists as.
 */
type GitflowBaseRow =
  | { kind: 'local'; branch: LocalBranchInfo }
  | { kind: 'remote'; branch: RemoteBranchInfo };

interface RepoSidebarProps {
  /** Absolute path of the open repository (drives the worktree dialog defaults). */
  repoPath: string;
  /** The repo's refs, or null while still loading. */
  refs: RepoRefs | null;
  /**
   * A branch row was selected (single click): its tip commit should be
   * highlighted in the commit list. `label` is the decoration the tip carries —
   * a local branch's short name, or a remote branch's `remote/name`.
   */
  onSelectRef?: (label: string) => void;
  /**
   * A stash row was selected (single click): the matching stash row in the
   * commit list should be highlighted. `index` is the stash's `stash@{index}`.
   */
  onSelectStash?: (index: number) => void;
  /**
   * Check out a branch (double-clicking its row). `remote` is passed for a
   * remote branch so a tracking branch is created off that specific remote.
   */
  onCheckout: (branch: string, remote?: string) => void;
  /** Merge a local branch into the current one, from a branch row's context menu. */
  onMergeBranch: (source: string, target: string) => void;
  /** Rebase the current branch onto another, from a branch row's context menu. */
  onRebaseBranch: (source: string, target: string) => void;
  /** Rename a local branch (`git branch -m`), from a branch row's context menu. */
  onRenameBranch: (oldName: string, newName: string) => void;
  /** Delete a local branch (`git branch -D`), from a branch row's context menu. */
  onDeleteBranch: (branch: string) => void;
  /** Delete a branch on its remote (`git push <remote> --delete`). */
  onDeleteRemoteBranch: (remote: string, branch: string) => void;
  /** Apply a stash by index, keeping it (`git stash apply`). */
  onStashApply: (index: number) => void;
  /** Apply & drop a stash by index (`git stash pop`). */
  onStashPop: (index: number) => void;
  /** Discard a stash by index (`git stash drop`). */
  onStashDrop: (index: number) => void;
  /** A worktree was added via the dialog: refs should reload. */
  onWorktreeAdded: () => void;
  /** Remove the worktree at `path`; `force` when dirty, `deleteBranch` to drop its branch. */
  onWorktreeRemove: (path: string, force: boolean, deleteBranch: boolean) => void;
  /** Lock (`lock: true`) or unlock the worktree at `path`. */
  onWorktreeLock: (path: string, lock: boolean) => void;
  /** Open a worktree's folder as a repository in the current tab. */
  onOpenWorktreeHere: (path: string) => void;
  /** Open a worktree's folder as a repository in a new tab. */
  onOpenWorktreeInNewTab: (path: string) => void;
  /** The repo's gitflow config, or null when it hasn't been configured yet. */
  gitflowConfig: GitflowConfig | null;
  /** Persist the repo's gitflow config; resolves with the saved config or error. */
  onGitflowSaveConfig: (config: GitflowConfig) => Promise<GitflowConfigResult>;
  /** Start a gitflow topic branch of `kind` named `name`, based off `source`. */
  onGitflowStart: (kind: GitflowKind, name: string, source: string) => void;
  /** Finish the current gitflow topic branch. */
  onGitflowFinish: () => void;
  /** Open the settings modal, optionally to a section (e.g. Integrations). */
  onOpenSettings?: (section?: string) => void;
}

/**
 * Left column: collapsible groups for local/remote branches, pull requests and
 * tags. Branches and tags come from the real repository (fetched by RepoView);
 * branch names are grouped into a collapsible folder tree by their
 * slash-delimited segments.
 *
 * Pull requests still come from mock data — they need a connected host's API,
 * which is a separate feature.
 */
export function RepoSidebar({
  repoPath,
  refs,
  onSelectRef,
  onSelectStash,
  onCheckout,
  onMergeBranch,
  onRebaseBranch,
  onRenameBranch,
  onDeleteBranch,
  onDeleteRemoteBranch,
  onStashApply,
  onStashPop,
  onStashDrop,
  onWorktreeAdded,
  onWorktreeRemove,
  onWorktreeLock,
  onOpenWorktreeHere,
  onOpenWorktreeInNewTab,
  gitflowConfig,
  onGitflowSaveConfig,
  onGitflowStart,
  onGitflowFinish,
  onOpenSettings,
}: RepoSidebarProps) {
  const [active, setActive] = useState<string | null>(null);
  // Whether the "start a gitflow branch" dialog is open.
  const [gitflowStartOpen, setGitflowStartOpen] = useState(false);
  // Whether the gitflow settings dialog is open.
  const [gitflowSettingsOpen, setGitflowSettingsOpen] = useState(false);
  // The branch delete menu opened by right-clicking a branch row, anchored at the
  // click point; null when closed.
  const [contextMenu, setContextMenu] = useState<{
    target: BranchMenuTarget;
    x: number;
    y: number;
  } | null>(null);
  const openBranchMenu = useCallback(
    (target: BranchMenuTarget, x: number, y: number) => setContextMenu({ target, x, y }),
    [],
  );
  // The stash apply/pop/delete menu opened by right-clicking a stash row, anchored
  // at the click point; null when closed.
  const [stashMenu, setStashMenu] = useState<{
    target: StashMenuTarget;
    x: number;
    y: number;
  } | null>(null);
  const openStashMenu = useCallback(
    (target: StashMenuTarget, x: number, y: number) => setStashMenu({ target, x, y }),
    [],
  );
  // Whether the "add a worktree" dialog is open.
  const [worktreeDialogOpen, setWorktreeDialogOpen] = useState(false);
  // The open/remove menu opened by right-clicking a worktree row; null when closed.
  const [worktreeMenu, setWorktreeMenu] = useState<{
    target: WorktreeMenuTarget;
    x: number;
    y: number;
  } | null>(null);
  const openWorktreeMenu = useCallback(
    (target: WorktreeMenuTarget, x: number, y: number) =>
      setWorktreeMenu({ target, x, y }),
    [],
  );

  // Persisted open/closed state of each section, keyed by a stable id. Missing
  // keys default to closed, so a repo opened for the first time is all-collapsed.
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let live = true;
    void window.api.app.getSidebarSections().then((state) => {
      if (live) setSectionOpen(state);
    });
    return () => {
      live = false;
    };
  }, []);

  // Props wiring a section to the persisted store: controlled `open` (default
  // closed) plus an `onToggle` that updates local state and persists it.
  const sectionProps = useCallback(
    (key: string) => ({
      open: sectionOpen[key] ?? false,
      onToggle: (next: boolean) => {
        setSectionOpen((prev) => ({ ...prev, [key]: next }));
        void window.api.app.setSidebarSection(key, next);
      },
    }),
    [sectionOpen],
  );

  const loading = refs === null;
  const localBranches = refs?.localBranches ?? [];
  const remoteBranches = refs?.remoteBranches ?? [];
  const stashes = refs?.stashes ?? [];
  // All worktrees, including the main one (flagged as current in its row).
  const worktrees = refs?.worktrees ?? [];
  const currentBranch = localBranches.find((branch) => branch.current)?.name;

  // The repo's gitflow branches for the section body, or null when unconfigured:
  // the configured base branches (main + develop) followed by the topic branches
  // grouped by kind (feature/release/hotfix) via their prefixes. Locals are always
  // listed (a just-started branch that hasn't been pushed lives only here); remotes
  // are listed too, minus any whose bare name already exists locally so a pushed
  // branch isn't shown twice. `count` totals every row, for the header badge.
  const gitflowBranches = useMemo(() => {
    if (!gitflowConfig) return null;
    const localNames = new Set(localBranches.map((branch) => branch.name));

    // Base branches, in config order, preferring the local branch and falling
    // back to a remote when the base exists only on a remote.
    const bases: GitflowBaseRow[] = [];
    const seenBase = new Set<string>();
    for (const name of [gitflowConfig.mainBranch, gitflowConfig.developBranch]) {
      if (seenBase.has(name)) continue;
      seenBase.add(name);
      const local = localBranches.find((branch) => branch.name === name);
      if (local) {
        bases.push({ kind: 'local', branch: local });
        continue;
      }
      const remote = remoteBranches.find((branch) => branch.name === name);
      if (remote) bases.push({ kind: 'remote', branch: remote });
    }

    const defs: { kind: GitflowKind; label: string; prefix: string }[] = [
      { kind: 'feature', label: 'Feature', prefix: gitflowConfig.featurePrefix },
      { kind: 'release', label: 'Release', prefix: gitflowConfig.releasePrefix },
      { kind: 'hotfix', label: 'Hotfix', prefix: gitflowConfig.hotfixPrefix },
    ];
    const groups = defs
      .map(({ kind, label, prefix }) => ({
        kind,
        label,
        prefix,
        locals: localBranches.filter((branch) => branch.name.startsWith(prefix)),
        remotes: remoteBranches.filter(
          (branch) => branch.name.startsWith(prefix) && !localNames.has(branch.name),
        ),
      }))
      .filter((group) => group.locals.length > 0 || group.remotes.length > 0);

    const count =
      bases.length +
      groups.reduce((sum, group) => sum + group.locals.length + group.remotes.length, 0);
    return { bases, groups, count };
  }, [gitflowConfig, localBranches, remoteBranches]);

  // Descending so the newest/highest tag (e.g. v0.2.0 before v0.1.0) is first.
  // `numeric` compares version segments as numbers, so v0.10 sorts above v0.2.
  const tags = useMemo(
    () =>
      [...(refs?.tags ?? [])].sort((a, b) =>
        b.name.localeCompare(a.name, undefined, { sensitivity: 'base', numeric: true }),
      ),
    [refs?.tags],
  );

  const localTree = useMemo(
    () => buildTree(localBranches, (branch) => branch.name),
    [localBranches],
  );

  // Remote branches: a folder per remote (origin, upstream, …), each holding a
  // tree of that remote's branches, badged with its host's icon (from its URL).
  const remotes = useMemo(() => {
    const urlByRemote = new Map((refs?.remotes ?? []).map((r) => [r.name, r.url]));
    const byRemote = new Map<string, RemoteBranchInfo[]>();
    for (const branch of remoteBranches) {
      const list = byRemote.get(branch.remote);
      if (list) list.push(branch);
      else byRemote.set(branch.remote, [branch]);
    }
    return [...byRemote.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map(([remote, branches]) => ({
        remote,
        url: urlByRemote.get(remote),
        tree: buildTree(branches, (branch) => branch.name),
      }));
  }, [remoteBranches, refs?.remotes]);

  // Branches offered in the worktree dialog's "Check out" select: every local
  // branch by its bare name, then every remote branch as "<remote>/<name>", each
  // group sorted. Remote entries carry the bare name as the default branch name.
  const worktreeBranchOptions = useMemo<WorktreeBranchOption[]>(() => {
    const byName = (a: { ref: string }, b: { ref: string }) =>
      a.ref.localeCompare(b.ref, undefined, { sensitivity: 'base' });
    const locals: WorktreeBranchOption[] = localBranches
      .map((branch) => ({ ref: branch.name, remote: false, name: branch.name }))
      .sort(byName);
    const remotes: WorktreeBranchOption[] = remoteBranches
      .map((branch) => ({
        ref: `${branch.remote}/${branch.name}`,
        remote: true,
        // Default local branch name for a remote checkout, e.g. "origin-dev", so
        // it doesn't collide with an existing local branch of the bare name.
        name: `${branch.remote}-${branch.name}`,
      }))
      .sort(byName);
    return [...locals, ...remotes];
  }, [localBranches, remoteBranches]);

  // Branches already checked out in a worktree (the main one included) — git won't
  // let the same branch be checked out in a second worktree, so the dialog blocks it.
  const occupiedBranches = useMemo(
    () =>
      (refs?.worktrees ?? [])
        .map((worktree) => worktree.branch)
        .filter((branch): branch is string => !!branch),
    [refs?.worktrees],
  );

  const placeholder = (empty: string) => (
    <p className="repo-section-empty">{loading ? 'Loading…' : empty}</p>
  );

  // --- Pull requests -------------------------------------------------------

  // The remote the PRs belong to: prefer `origin`, else the first remote that
  // has a URL. Everything about PRs keys off this URL.
  const remoteUrl = useMemo(() => {
    const list = refs?.remotes ?? [];
    const origin = list.find((remote) => remote.name === 'origin' && remote.url);
    return (origin ?? list.find((remote) => remote.url))?.url ?? null;
  }, [refs?.remotes]);

  const prProvider = providerOfUrl(remoteUrl);

  // Branch names offered when opening a new PR: every local and remote branch,
  // de-duplicated and sorted. A remote branch shares its bare name with the
  // local one it tracks, so the Set collapses the pair.
  const prBranchOptions = useMemo(() => {
    const names = new Set<string>();
    for (const branch of localBranches) names.add(branch.name);
    for (const branch of remoteBranches) names.add(branch.name);
    return [...names].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }, [localBranches, remoteBranches]);

  const defaultTarget = useMemo(
    () =>
      ['main', 'master', 'develop'].find((name) => prBranchOptions.includes(name)) ??
      prBranchOptions.find((name) => name !== currentBranch),
    [prBranchOptions, currentBranch],
  );

  const [prResult, setPrResult] = useState<PullRequestListResult | null>(null);
  const [detailPr, setDetailPr] = useState<PullRequestSummary | null>(null);
  const [creatingPr, setCreatingPr] = useState(false);
  // Bumped after opening a PR to re-list without waiting for the next refs load.
  const [prReload, setPrReload] = useState(0);

  // List the repo's pull/merge requests whenever the remote (or a manual reload)
  // changes. `pullRequests` never rejects — it returns a tagged result — so the
  // section can show a precise hint (unsupported host / not connected / error).
  useEffect(() => {
    if (!remoteUrl) {
      setPrResult({ status: 'unsupported' });
      return;
    }
    let live = true;
    setPrResult(null);
    void window.api.integrations.pullRequests(remoteUrl).then((result) => {
      if (live) setPrResult(result);
    });
    return () => {
      live = false;
    };
  }, [remoteUrl, prReload]);

  // Re-list when an account is connected/disconnected while a repo is open, so a
  // "connect GitHub" hint turns into the actual list without a manual refresh.
  useEffect(
    () => window.api.integrations.onChange(() => setPrReload((n) => n + 1)),
    [],
  );

  const pulls = prResult?.status === 'ok' ? prResult.pulls : [];
  // Provider for the detail/create dialogs: the list result is authoritative,
  // but fall back to the URL guess so the create button works before the list
  // resolves.
  const dialogProvider: IntegrationProvider | null =
    prResult?.status === 'ok'
      ? prResult.host.provider
      : prResult?.status === 'disconnected'
        ? prResult.provider
        : prProvider;

  // What the PR section body shows for the non-list states.
  const prPlaceholder = (() => {
    if (prResult === null) return loading ? null : placeholder('Loading…');
    switch (prResult.status) {
      case 'ok':
        return pulls.length === 0 ? placeholder('No pull requests') : null;
      case 'unsupported':
        return placeholder('This remote has no GitHub or GitLab pull requests.');
      case 'disconnected':
        return (
          <button
            type="button"
            className="repo-section-empty repo-pr-connect"
            onClick={() => onOpenSettings?.('integrations')}
          >
            {`Connect ${PROVIDER_LABEL[prResult.provider]} to see pull requests.`}
          </button>
        );
      case 'error':
        return <p className="repo-section-empty">{prResult.message}</p>;
    }
  })();

  return (
    <nav className="repo-sidebar" aria-label="Repository navigation">
      <CollapsibleSection
        label="Gitflow"
        icon={<GitflowIcon size={16} />}
        count={gitflowBranches?.count}
        action={
          <button
            type="button"
            className="pill-btn pill-btn-green repo-gitflow-new tooltip-host"
            aria-label={gitflowConfig ? 'Gitflow actions' : 'Set up gitflow'}
            data-tooltip={gitflowConfig ? 'Gitflow actions' : 'Set up gitflow'}
            onClick={() => {
              // Unconfigured repos go straight to the settings dialog; configured
              // ones open the "start a branch" dialog.
              if (gitflowConfig) setGitflowStartOpen(true);
              else setGitflowSettingsOpen(true);
            }}
          >
            <PlusIcon size={12} />
          </button>
        }
        {...sectionProps('gitflow')}
      >
        {gitflowBranches === null ? (
          <p className="repo-section-empty">
            Gitflow isn’t set up for this repo yet — use + to configure branch names.
          </p>
        ) : gitflowBranches.count === 0 ? (
          <p className="repo-section-empty">
            Use + to start a feature, release, or hotfix branch.
          </p>
        ) : (
          <>
            {/* Configured base branches (main/develop) at the top level. */}
            {gitflowBranches.bases.map((row) =>
              row.kind === 'local' ? (
                <LocalBranchRow
                  key={`gf-base-local:${row.branch.name}`}
                  branch={row.branch}
                  label={row.branch.name}
                  depth={0}
                  id={`local:${row.branch.name}`}
                  active={active}
                  onSelect={(id) => {
                    setActive(id);
                    onSelectRef?.(row.branch.name);
                  }}
                  onCheckout={onCheckout}
                  onOpenMenu={openBranchMenu}
                />
              ) : (
                <RemoteBranchRow
                  key={`gf-base-remote:${row.branch.remote}/${row.branch.name}`}
                  full={`${row.branch.remote}/${row.branch.name}`}
                  name={row.branch.name}
                  remote={row.branch.remote}
                  label={`${row.branch.remote}/${row.branch.name}`}
                  depth={0}
                  id={`remote:${row.branch.remote}/${row.branch.name}`}
                  active={active}
                  onSelect={(id) => {
                    setActive(id);
                    onSelectRef?.(`${row.branch.remote}/${row.branch.name}`);
                  }}
                  onCheckout={onCheckout}
                  onOpenMenu={openBranchMenu}
                />
              ),
            )}
            {/* Topic branches, grouped by kind. */}
            {gitflowBranches.groups.map((group) => (
              <TreeFolder key={group.kind} name={group.label} depth={0} icon={<BranchIcon size={14} />}>
                {group.locals.map((branch) => (
                  <LocalBranchRow
                    key={`gf-local:${branch.name}`}
                    branch={branch}
                    label={branch.name.slice(group.prefix.length) || branch.name}
                    depth={1}
                    id={`local:${branch.name}`}
                    active={active}
                    onSelect={(id) => {
                      setActive(id);
                      onSelectRef?.(branch.name);
                    }}
                    onCheckout={onCheckout}
                    onOpenMenu={openBranchMenu}
                  />
                ))}
                {group.remotes.map((branch) => (
                  <RemoteBranchRow
                    key={`gf-remote:${branch.remote}/${branch.name}`}
                    full={`${branch.remote}/${branch.name}`}
                    name={branch.name}
                    remote={branch.remote}
                    label={`${branch.remote}/${branch.name.slice(group.prefix.length) || branch.name}`}
                    depth={1}
                    id={`remote:${branch.remote}/${branch.name}`}
                    active={active}
                    onSelect={(id) => {
                      setActive(id);
                      onSelectRef?.(`${branch.remote}/${branch.name}`);
                    }}
                    onCheckout={onCheckout}
                    onOpenMenu={openBranchMenu}
                  />
                ))}
              </TreeFolder>
            ))}
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        label="Local Branches"
        icon={<LocalIcon size={16} />}
        count={localBranches.length}
        {...sectionProps('local')}
      >
        {localBranches.length === 0 ? (
          placeholder('No local branches')
        ) : (
          <BranchTree
            nodes={localTree}
            depth={0}
            renderLeaf={(branch, leaf, depth) => (
              <LocalBranchRow
                branch={branch}
                label={leaf}
                depth={depth}
                id={`local:${branch.name}`}
                active={active}
                onSelect={(id) => {
                  setActive(id);
                  onSelectRef?.(branch.name);
                }}
                onCheckout={onCheckout}
                onOpenMenu={openBranchMenu}
              />
            )}
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection
        label="Remote Branches"
        icon={<RemoteIcon size={16} />}
        count={remoteBranches.length}
        {...sectionProps('remote')}
      >
        {remoteBranches.length === 0
          ? placeholder('No remote branches')
          : remotes.map(({ remote, url, tree }) => (
              <TreeFolder key={remote} name={remote} depth={0} icon={<RemoteAvatar url={url} />}>
                <BranchTree
                  nodes={tree}
                  depth={1}
                  renderLeaf={(branch, leaf, depth) => (
                    <RemoteBranchRow
                      full={`${remote}/${branch.name}`}
                      name={branch.name}
                      remote={remote}
                      label={leaf}
                      depth={depth}
                      id={`remote:${remote}/${branch.name}`}
                      active={active}
                      onSelect={(id) => {
                        setActive(id);
                        onSelectRef?.(`${remote}/${branch.name}`);
                      }}
                      onCheckout={onCheckout}
                      onOpenMenu={openBranchMenu}
                    />
                  )}
                />
              </TreeFolder>
            ))}
      </CollapsibleSection>

      <CollapsibleSection
        label="Worktrees"
        icon={<WorktreeIcon size={16} />}
        count={worktrees.length}
        action={
          <button
            type="button"
            className="pill-btn pill-btn-green repo-worktree-new tooltip-host"
            aria-label="Add a worktree"
            data-tooltip="Add a worktree"
            onClick={() => setWorktreeDialogOpen(true)}
          >
            <PlusIcon size={12} />
          </button>
        }
        {...sectionProps('worktrees')}
      >
        {worktrees.length === 0
          ? placeholder('No worktrees')
          : worktrees.map((worktree) => (
              <WorktreeRow
                key={worktree.path}
                worktree={worktree}
                id={`worktree:${worktree.path}`}
                active={active}
                onSelect={setActive}
                onOpen={onOpenWorktreeInNewTab}
                onOpenMenu={openWorktreeMenu}
              />
            ))}
      </CollapsibleSection>

      {stashes.length > 0 && (
        <CollapsibleSection
          label="Stashes"
          icon={<TrayIcon size={16} />}
          count={stashes.length}
          {...sectionProps('stashes')}
        >
          {stashes.map((stash) => (
            <StashRow
              key={stash.index}
              stash={stash}
              id={`stash:${stash.index}`}
              active={active}
              onSelect={(id) => {
                setActive(id);
                onSelectStash?.(stash.index);
              }}
              onOpenMenu={openStashMenu}
            />
          ))}
        </CollapsibleSection>
      )}

      <CollapsibleSection
        label="Pull Requests"
        icon={<PullRequestIcon size={16} />}
        count={prResult?.status === 'ok' ? pulls.length : undefined}
        action={
          prProvider && dialogProvider ? (
            <button
              type="button"
              className="pill-btn pill-btn-green repo-pr-new tooltip-host"
              aria-label="New pull request"
              data-tooltip="New pull request"
              onClick={() => setCreatingPr(true)}
            >
              <PlusIcon size={12} />
            </button>
          ) : undefined
        }
        {...sectionProps('pr')}
      >
        {prPlaceholder}
        {pulls.map((pr) => (
          <PullRequestRow
            key={pr.number}
            pr={pr}
            id={`pr:${pr.number}`}
            active={active}
            onSelect={setActive}
            onOpen={setDetailPr}
          />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        label="Tags"
        icon={<TagIcon size={16} />}
        count={tags.length}
        {...sectionProps('tags')}
      >
        {tags.length === 0
          ? placeholder('No tags')
          : tags.map((tag) => (
              <TagRow
                key={tag.name}
                tag={tag}
                id={`tag:${tag.name}`}
                active={active}
                onSelect={(id) => {
                  setActive(id);
                  onSelectRef?.(tag.name);
                }}
              />
            ))}
      </CollapsibleSection>
      {gitflowStartOpen && gitflowConfig && (
        <GitflowStartDialog
          config={gitflowConfig}
          currentBranch={currentBranch}
          branchOptions={prBranchOptions}
          onStart={onGitflowStart}
          onFinish={onGitflowFinish}
          // Layer the settings dialog on top rather than replacing this one, so
          // closing settings returns here with the in-progress form intact.
          onOpenSettings={() => setGitflowSettingsOpen(true)}
          onClose={() => setGitflowStartOpen(false)}
          suspended={gitflowSettingsOpen}
        />
      )}
      {gitflowSettingsOpen && (
        <GitflowSettingsDialog
          config={gitflowConfig}
          onSave={onGitflowSaveConfig}
          onClose={() => setGitflowSettingsOpen(false)}
        />
      )}
      {contextMenu && (
        <BranchContextMenu
          targets={[contextMenu.target]}
          x={contextMenu.x}
          y={contextMenu.y}
          currentBranch={currentBranch}
          onClose={() => setContextMenu(null)}
          onCheckout={onCheckout}
          onMerge={onMergeBranch}
          onRebase={onRebaseBranch}
          onRenameBranch={onRenameBranch}
          onDeleteBranch={onDeleteBranch}
          onDeleteRemoteBranch={onDeleteRemoteBranch}
        />
      )}
      {stashMenu && (
        <StashContextMenu
          target={stashMenu.target}
          x={stashMenu.x}
          y={stashMenu.y}
          onClose={() => setStashMenu(null)}
          onApply={onStashApply}
          onPop={onStashPop}
          onDrop={onStashDrop}
        />
      )}
      {worktreeMenu && (
        <WorktreeContextMenu
          target={worktreeMenu.target}
          x={worktreeMenu.x}
          y={worktreeMenu.y}
          onClose={() => setWorktreeMenu(null)}
          onOpenHere={onOpenWorktreeHere}
          onOpenInNewTab={onOpenWorktreeInNewTab}
          onRemove={onWorktreeRemove}
          onLock={onWorktreeLock}
        />
      )}
      {worktreeDialogOpen && (
        <WorktreeDialog
          repoPath={repoPath}
          branches={worktreeBranchOptions}
          occupiedBranches={occupiedBranches}
          onClose={() => setWorktreeDialogOpen(false)}
          onCreated={onWorktreeAdded}
          onOpen={onOpenWorktreeInNewTab}
        />
      )}
      {detailPr && dialogProvider && (
        <PullRequestDialog
          pull={detailPr}
          provider={dialogProvider}
          onClose={() => setDetailPr(null)}
        />
      )}
      {creatingPr && remoteUrl && dialogProvider && (
        <NewPullRequestDialog
          remoteUrl={remoteUrl}
          provider={dialogProvider}
          branches={prBranchOptions}
          defaultSource={currentBranch}
          defaultTarget={defaultTarget}
          onClose={() => setCreatingPr(false)}
          onCreated={() => setPrReload((n) => n + 1)}
        />
      )}
    </nav>
  );
}
