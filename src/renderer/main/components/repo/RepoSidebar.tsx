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
  CloseIcon,
  FolderIcon,
  GitflowIcon,
  PlusIcon,
  PopIcon,
  RemoteIcon,
  PullRequestIcon,
  StashIcon,
  TagIcon,
} from '../../../../../assets/icons';
import type {
  GitflowKind,
  LocalBranchInfo,
  RemoteBranchInfo,
  RepoRefs,
  StashInfo,
  TagInfo,
} from '../../../../types/ipc';
import { CollapsibleSection } from './CollapsibleSection';
import {
  MOCK_PULL_REQUESTS,
  type PullRequest,
  type PullRequestState,
} from './mockData';

const cx = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(' ');

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
}: RowProps & {
  branch: LocalBranchInfo;
  label: string;
  depth: number;
  onCheckout: (branch: string) => void;
}) {
  return (
    <button
      type="button"
      className={cx('repo-list-item', active === id && 'is-active', branch.current && 'is-current')}
      style={{ paddingLeft: indent(depth) }}
      aria-current={branch.current ? 'true' : undefined}
      onClick={() => onSelect(id)}
      onDoubleClick={() => {
        if (!branch.current) onCheckout(branch.name);
      }}
      title={`Double-click to check out ${branch.name}`}
    >
      {branch.current && (
        <span
          className="repo-branch-check"
          aria-label="Current branch"
        >
          <CheckIcon size={14} />
        </span>
      )}
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
}: RowProps & {
  full: string;
  name: string;
  remote: string;
  label: string;
  depth: number;
  onCheckout: (branch: string, remote?: string) => void;
}) {
  return (
    <button
      type="button"
      className={cx('repo-list-item', active === id && 'is-active')}
      style={{ paddingLeft: indent(depth) }}
      onClick={() => onSelect(id)}
      onDoubleClick={() => onCheckout(name, remote)}
      title={`Double-click to check out ${name}`}
    >
      <BranchIcon size={14} />
      <span className="repo-list-label" title={full}>
        {label}
      </span>
    </button>
  );
}

function PullRequestRow({ pr, id, active, onSelect }: RowProps & { pr: PullRequest }) {
  return (
    <button
      type="button"
      className={cx('repo-list-item', active === id && 'is-active')}
      style={{ paddingLeft: indent(0) }}
      onClick={() => onSelect(id)}
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
  onPop,
  onDrop,
}: RowProps & {
  stash: StashInfo;
  onPop: (index: number) => void;
  onDrop: (index: number) => void;
}) {
  return (
    <div
      className={cx('repo-list-item', 'repo-stash-item', active === id && 'is-active')}
      style={{ paddingLeft: indent(0) }}
    >
      <button
        type="button"
        className="repo-stash-main"
        onClick={() => onSelect(id)}
        title={stash.message}
      >
        <StashIcon size={14} />
        <span className="repo-list-label">{stash.message}</span>
      </button>
      <button
        type="button"
        className="repo-stash-action"
        onClick={() => onPop(stash.index)}
        title="Apply and drop this stash (pop)"
        aria-label="Pop stash"
      >
        <PopIcon size={14} />
      </button>
      <button
        type="button"
        className="repo-stash-action"
        onClick={() => onDrop(stash.index)}
        title="Discard this stash (drop)"
        aria-label="Drop stash"
      >
        <CloseIcon size={14} />
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
  /** Apply & drop a stash by index (`git stash pop`). */
  onStashPop: (index: number) => void;
  /** Discard a stash by index (`git stash drop`). */
  onStashDrop: (index: number) => void;
  /** Start a gitflow topic branch of `kind` named `name`. */
  onGitflowStart: (kind: GitflowKind, name: string) => void;
  /** Finish the current gitflow topic branch. */
  onGitflowFinish: () => void;
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
  onStashPop,
  onStashDrop,
  onGitflowStart,
  onGitflowFinish,
}: RepoSidebarProps) {
  const [active, setActive] = useState<string | null>(null);

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
  // tree of that remote's branches.
  const remotes = useMemo(() => {
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
        tree: buildTree(branches, (branch) => branch.name),
      }));
  }, [remoteBranches]);

  const placeholder = (empty: string) => (
    <p className="repo-section-empty">{loading ? 'Loading…' : empty}</p>
  );

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
        icon={<BranchIcon size={16} />}
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
          : remotes.map(({ remote, tree }) => (
              <TreeFolder key={remote} name={remote} depth={0} icon={<RemoteIcon size={14} />}>
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
                    />
                  )}
                />
              </TreeFolder>
            ))}
      </CollapsibleSection>

      <CollapsibleSection
        label="Stashes"
        icon={<StashIcon size={16} />}
        count={stashes.length}
        {...sectionProps('stashes')}
      >
        {stashes.length === 0
          ? placeholder('No stashes')
          : stashes.map((stash) => (
              <StashRow
                key={stash.index}
                stash={stash}
                id={`stash:${stash.index}`}
                active={active}
                onSelect={(id) => {
                  setActive(id);
                  onSelectStash?.(stash.index);
                }}
                onPop={onStashPop}
                onDrop={onStashDrop}
              />
            ))}
      </CollapsibleSection>

      <CollapsibleSection
        label="Pull Requests"
        icon={<PullRequestIcon size={16} />}
        count={MOCK_PULL_REQUESTS.length}
        {...sectionProps('pr')}
      >
        {MOCK_PULL_REQUESTS.map((pr) => (
          <PullRequestRow
            key={pr.number}
            pr={pr}
            id={`pr:${pr.number}`}
            active={active}
            onSelect={setActive}
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
    </nav>
  );
}
