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
} from '../../../../../assets/icons';
import { RemoteAvatar } from './RemoteAvatar';
import { BranchContextMenu, type BranchMenuTarget } from './BranchContextMenu';
import { StashContextMenu, type StashMenuTarget } from './StashContextMenu';
import type {
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
} from '../../../../types/ipc';
import { CollapsibleSection } from './CollapsibleSection';
import { PullRequestDialog } from './PullRequestDialog';
import { NewPullRequestDialog } from './NewPullRequestDialog';

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
        className="repo-row-main"
        aria-current={branch.current ? 'true' : undefined}
        onClick={() => onSelect(id)}
        onDoubleClick={() => {
          if (!branch.current) onCheckout(branch.name);
        }}
        title={`Double-click to check out ${branch.name}`}
      >
        <BranchIcon size={14} />
        <span className="repo-list-label" title={branch.name}>
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
        className="repo-row-action"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu(target, rect.right, rect.bottom);
        }}
        title="Branch actions"
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
        className="repo-row-main"
        onClick={() => onSelect(id)}
        onDoubleClick={() => onCheckout(name, remote)}
        title={`Double-click to check out ${name}`}
      >
        <BranchIcon size={14} />
        <span className="repo-list-label" title={full}>
          {label}
        </span>
      </button>
      <button
        type="button"
        className="repo-row-action"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu(target, rect.right, rect.bottom);
        }}
        title="Branch actions"
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
      className={cx('repo-list-item', active === id && 'is-active')}
      style={{ paddingLeft: indent(0) }}
      onClick={() => {
        onSelect(id);
        onOpen(pr);
      }}
      title={pr.title}
    >
      <span className={cx('repo-pr-icon', `pr-state-${pr.state}`)}>
        <PullRequestIcon size={14} />
      </span>
      <span className="repo-pr-number">#{pr.number}</span>
      <span className="repo-list-label" title={pr.title}>
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
      <span className="repo-list-label" title={tag.name}>
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
        className="repo-row-main"
        onClick={() => onSelect(id)}
        title={stash.branch ? `${stash.message} on: ${stash.branch}` : stash.message}
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
        className="repo-row-action"
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
        title="Stash actions"
        aria-label="Stash actions"
      >
        <MoreIcon size={16} />
      </button>
    </div>
  );
}

const GITFLOW_ACTIONS: { kind: GitflowKind; label: string }[] = [
  { kind: 'feature', label: 'Feature' },
  { kind: 'release', label: 'Release' },
  { kind: 'hotfix', label: 'Hotfix' },
];

/** Which gitflow kind the branch belongs to (feature/release/hotfix), or null. */
function gitflowKindOf(branch: string | undefined): GitflowKind | null {
  if (!branch) return null;
  return GITFLOW_ACTIONS.find(({ kind }) => branch.startsWith(`${kind}/`))?.kind ?? null;
}

/**
 * Gitflow actions: three "Start …" buttons that reveal an inline name input,
 * and a "Finish" button enabled only while a gitflow topic branch is checked
 * out. Starting creates `<kind>/<name>`; finishing merges it back into its base.
 */
function GitflowPanel({
  currentBranch,
  onStart,
  onFinish,
}: {
  currentBranch: string | undefined;
  onStart: (kind: GitflowKind, name: string) => void;
  onFinish: () => void;
}) {
  const [openKind, setOpenKind] = useState<GitflowKind | null>(null);
  const [name, setName] = useState('');

  const currentKind = gitflowKindOf(currentBranch);

  const submit = () => {
    const trimmed = name.trim();
    if (openKind && trimmed) {
      onStart(openKind, trimmed);
      setName('');
      setOpenKind(null);
    }
  };

  return (
    <div className="repo-gitflow">
      {GITFLOW_ACTIONS.map(({ kind, label }) => (
        <Fragment key={kind}>
          <button
            type="button"
            className={cx('repo-gitflow-action', openKind === kind && 'is-open')}
            onClick={() => {
              setName('');
              setOpenKind((prev) => (prev === kind ? null : kind));
            }}
          >
            <PlusIcon size={14} />
            <span>Start {label}</span>
          </button>
          {openKind === kind && (
            <input
              className="repo-gitflow-input"
              autoFocus
              value={name}
              placeholder={`${kind}/name`}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
                else if (event.key === 'Escape') {
                  setOpenKind(null);
                  setName('');
                }
              }}
              onBlur={() => setOpenKind(null)}
            />
          )}
        </Fragment>
      ))}
      <button
        type="button"
        className="repo-gitflow-action"
        disabled={currentKind === null}
        onClick={onFinish}
        title={
          currentKind
            ? `Finish ${currentBranch} into its base branch`
            : 'Check out a gitflow branch to finish it'
        }
      >
        <CheckIcon size={14} />
        <span>{currentKind ? `Finish ${currentBranch}` : 'Finish current'}</span>
      </button>
    </div>
  );
}

// --- Sidebar ----------------------------------------------------------------

interface RepoSidebarProps {
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
  /** Start a gitflow topic branch of `kind` named `name`. */
  onGitflowStart: (kind: GitflowKind, name: string) => void;
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
  onGitflowStart,
  onGitflowFinish,
  onOpenSettings,
}: RepoSidebarProps) {
  const [active, setActive] = useState<string | null>(null);
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
  const currentBranch = localBranches.find((branch) => branch.current)?.name;

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
        {...sectionProps('gitflow')}
      >
        <GitflowPanel
          currentBranch={currentBranch}
          onStart={onGitflowStart}
          onFinish={onGitflowFinish}
        />
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
              className="pill-btn pill-btn-green repo-pr-new"
              aria-label="New pull request"
              title="New pull request"
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
