import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CommitDetailData,
  CommitLogEntry,
  DiffSource,
  FileChange,
  FileStatus,
  WorkingStatus,
} from '../../../../types/ipc';
import type { DiffTarget } from './DiffView';
import { useConfirm } from '../ConfirmBar';
import {
  CertificateIcon,
  ChevronDownIcon,
  FolderIcon,
  ListIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  SortIcon,
  TrashIcon,
  TreeIcon,
} from '../../../../../assets/icons';

/** `%G?` status char: 'N'/'E' mean no verifiable signature; anything else is signed. */
const isSigned = (signature: string) => signature !== '' && signature !== 'N';

/** Per-status glyph, matching the change/add/delete icons used in the counts
 * summary and the working row (renames reuse the modified pencil). */
function statusIcon(status: FileStatus) {
  switch (status) {
    case 'added':
      return <PlusIcon size={14} />;
    case 'deleted':
      return <MinusIcon size={14} />;
    default:
      return <PencilIcon size={14} />;
  }
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const formatDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFmt.format(date);
};

const baseName = (path: string) => path.split('/').pop() ?? path;
const dirName = (path: string) => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash + 1);
};

/** Split a commit message into its subject (first line) and body (the rest). */
const splitMessage = (message: string) => {
  const nl = message.indexOf('\n');
  if (nl === -1) return { subject: message, body: '' };
  return { subject: message.slice(0, nl), body: message.slice(nl + 1).replace(/^\n+/, '') };
};

/** Recombine an edited subject + body into a conventional commit message. */
const joinMessage = (subject: string, body: string) => {
  const trimmedBody = body.trim();
  return trimmedBody ? `${subject.trim()}\n\n${trimmedBody}` : subject.trim();
};

/**
 * Live join of the two working-tree message fields into the shared message, kept
 * lenient (no trimming) so typing round-trips cleanly through {@link splitMessage}.
 */
const composeMessage = (subject: string, body: string) =>
  body ? `${subject}\n\n${body}` : subject;

/** Conventional soft limit for a commit summary line. */
const SUMMARY_LIMIT = 72;

/**
 * Countdown of characters remaining against {@link SUMMARY_LIMIT}. Goes negative
 * once the summary runs long, turning yellow as a soft warning (never blocks).
 */
function SummaryCounter({ length }: { length: number }) {
  const remaining = SUMMARY_LIMIT - length;
  return (
    <span
      className={`commit-summary-counter${remaining < 0 ? ' is-over' : ''}`}
      title={`${SUMMARY_LIMIT}-character summary guideline`}
      aria-hidden="true"
    >
      {remaining}
    </span>
  );
}

/** A row in the file list: a real change, or (in "View all files" mode) an
 * unchanged file from the commit snapshot, marked by a null status. */
type DisplayFile = { path: string; status: FileStatus | null };

/** Whether two diff sources refer to the same revision. */
function sameSource(a: DiffSource, b: DiffSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'commit' && b.kind === 'commit') return a.hash === b.hash;
  return true;
}

interface FileRowProps {
  file: DisplayFile;
  /** Optional stage/unstage control; omitted in the read-only detail view. */
  action?: {
    label: string;
    title: string;
    onClick: () => void;
    /** Pill color modifier (see `.pill-btn-*` in the stylesheet). */
    variant?: 'green' | 'red' | 'yellow' | 'gray';
  };
  /** Hide the directory suffix (tree view already conveys the folder). */
  showDir?: boolean;
  /** Left indent in px, for nesting a file under its folder in tree view. */
  indent?: number;
  /** Open this file in the center diff viewer (row becomes clickable). */
  onOpen?: () => void;
  /** Whether this file is the one currently shown in the diff viewer. */
  selected?: boolean;
}

function FileRow({ file, action, showDir = true, indent, onOpen, selected }: FileRowProps) {
  const classes = ['commit-file', 'tooltip-host'];
  if (!file.status) classes.push('commit-file-unchanged');
  if (onOpen) classes.push('is-openable');
  if (selected) classes.push('is-open');
  return (
    <div
      className={classes.join(' ')}
      data-tooltip={file.path}
      style={indent ? { paddingLeft: indent } : undefined}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-pressed={onOpen ? selected : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
    >
      {file.status ? (
        <span className={`commit-file-status status-${file.status}`} title={file.status}>
          {statusIcon(file.status)}
        </span>
      ) : (
        <span className="commit-file-status" title="unchanged" aria-hidden="true" />
      )}
      <span className="commit-file-path">
        {showDir && dirName(file.path) && (
          <span className="commit-file-dir">{dirName(file.path)}</span>
        )}
        <span className="commit-file-name">{baseName(file.path)}</span>
      </span>
      {action && (
        <button
          type="button"
          className={`pill-btn commit-file-action${action.variant ? ` pill-btn-${action.variant}` : ''}`}
          title={action.title}
          aria-label={action.title}
          // Don't let the stage/unstage control also open the diff.
          onClick={(event) => {
            event.stopPropagation();
            action.onClick();
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Per-status tallies for a commit's changed files (renames fold into modified). */
const fileCounts = (files: FileChange[]) => {
  const counts = { modified: 0, added: 0, deleted: 0 };
  for (const file of files) {
    if (file.status === 'added') counts.added++;
    else if (file.status === 'deleted') counts.deleted++;
    else counts.modified++;
  }
  return counts;
};

interface TreeDir {
  name: string;
  /** Full slash-joined path, used as the collapse/expand key. */
  path: string;
  dirs: Map<string, TreeDir>;
  files: DisplayFile[];
}

/** Group a flat file list into a folder tree keyed by path segments. */
function buildTree(files: DisplayFile[]): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    parts.pop(); // drop the file name; the leaf lives in its folder
    let node = root;
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      let child = node.dirs.get(part);
      if (!child) {
        child = { name: part, path: acc, dirs: new Map(), files: [] };
        node.dirs.set(part, child);
      }
      node = child;
    }
    node.files.push(file);
  }
  return root;
}

interface DirNodeProps {
  dir: TreeDir;
  depth: number;
  /** Ascending sort? Applied to both folders and files at every level. */
  asc: boolean;
  /** Collapsed folder paths. */
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  /** Open a leaf file in the diff viewer. */
  onOpenFile?: (file: DisplayFile) => void;
  /** Per-file stage/unstage control, threaded down to each leaf row. */
  action?: (file: DisplayFile) => FileRowProps['action'];
  /** Path of the file currently shown in the diff viewer, if any. */
  activePath?: string | null;
}

/** Recursively render a folder's subfolders (first) then its files. */
function DirNode({ dir, depth, asc, collapsed, onToggle, onOpenFile, action, activePath }: DirNodeProps) {
  const dirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...dir.files].sort((a, b) =>
    baseName(a.path).localeCompare(baseName(b.path)),
  );
  if (!asc) {
    dirs.reverse();
    files.reverse();
  }
  return (
    <>
      {dirs.map((child) => {
        const open = !collapsed.has(child.path);
        return (
          <div key={child.path}>
            <button
              type="button"
              className="commit-tree-dir"
              style={{ paddingLeft: 6 + depth * 14 }}
              aria-expanded={open}
              onClick={() => onToggle(child.path)}
            >
              <span className={`commit-tree-caret${open ? '' : ' collapsed'}`}>
                <ChevronDownIcon size={14} />
              </span>
              <FolderIcon size={14} />
              <span className="commit-tree-dir-name">{child.name}</span>
            </button>
            {open && (
              <DirNode
                dir={child}
                depth={depth + 1}
                asc={asc}
                collapsed={collapsed}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
                action={action}
                activePath={activePath}
              />
            )}
          </div>
        );
      })}
      {files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          showDir={false}
          indent={6 + depth * 14}
          action={action?.(file)}
          onOpen={onOpenFile ? () => onOpenFile(file) : undefined}
          selected={file.path === activePath}
        />
      ))}
    </>
  );
}

interface CommitFilesProps {
  repoPath: string;
  hash: string;
  /** The commit's changed files; null while loading. */
  files: FileChange[] | null;
  /** Open a file in the center diff viewer. */
  onOpenDiff: (target: DiffTarget) => void;
  /** The diff target currently shown, so its row can be highlighted. */
  activeDiff: DiffTarget | null;
}

/**
 * The commit-detail files section: a counts + controls toolbar over a flat list
 * or folder tree of the commit's files. By default it lists only the commit's
 * changes; "View all files" fetches the full repository snapshot as of that
 * commit and marks the changed files within it.
 */
function CommitFiles({ repoPath, hash, files, onOpenDiff, activeDiff }: CommitFilesProps) {
  const [asc, setAsc] = useState(true);
  const [mode, setMode] = useState<'list' | 'tree'>('list');
  const [viewAll, setViewAll] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // This section always diffs against the commit; the active row is the one
  // whose path matches an open diff taken from this same commit.
  const source: DiffSource = { kind: 'commit', hash };
  const activePath =
    activeDiff && sameSource(activeDiff.source, source) ? activeDiff.path : null;
  const openFile = (file: DisplayFile) => {
    // Unchanged snapshot rows (null status) carry no diff; treat them as modified
    // for the header glyph so the viewer can still show the file's content.
    onOpenDiff({ source, path: file.path, status: file.status ?? 'modified' });
  };
  // The full tree snapshot at this commit, fetched lazily the first time
  // "View all files" is enabled; null until then / while loading.
  const [allPaths, setAllPaths] = useState<string[] | null>(null);

  // A new commit drops the previously fetched snapshot.
  useEffect(() => {
    setAllPaths(null);
  }, [repoPath, hash]);

  useEffect(() => {
    if (!viewAll || allPaths !== null) return;
    let live = true;
    void window.api.repo.commitTree(repoPath, hash).then((paths) => {
      if (live) setAllPaths(paths);
    });
    return () => {
      live = false;
    };
  }, [viewAll, allPaths, repoPath, hash]);

  const toggleDir = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Counts always reflect the commit's own changes, regardless of view mode.
  const counts = useMemo(() => fileCounts(files ?? []), [files]);

  // The rows to render: changed-only, or the full snapshot with changes marked.
  // null means we're still waiting on the data the current mode needs.
  const display = useMemo<DisplayFile[] | null>(() => {
    if (!files) return null;
    if (!viewAll) return files;
    if (allPaths === null) return null;
    const changed = new Map(files.map((file) => [file.path, file.status]));
    // Union the snapshot with the changed set so files the commit deleted (absent
    // from the tree) still appear.
    const paths = new Set([...allPaths, ...changed.keys()]);
    return [...paths].map((path) => ({ path, status: changed.get(path) ?? null }));
  }, [files, viewAll, allPaths]);

  const sorted = useMemo(() => {
    if (!display) return null;
    const arr = [...display].sort((a, b) => a.path.localeCompare(b.path));
    if (!asc) arr.reverse();
    return arr;
  }, [display, asc]);

  // "View all files" forces the tree view (a flat list of the whole repo is
  // unwieldy) and hides the list toggle.
  const effectiveMode = viewAll ? 'tree' : mode;

  return (
    <div className="commit-files">
      <div className="commit-files-header commit-files-header-toolbar">
        <span className="commit-files-counts" aria-hidden="true">
          {counts.modified > 0 && (
            <span className="commit-files-count commit-files-modified" title="Modified files">
              <PencilIcon size={12} />
              {counts.modified} modified
            </span>
          )}
          {counts.added > 0 && (
            <span className="commit-files-count commit-files-added" title="Added files">
              <PlusIcon size={12} />
              {counts.added} added
            </span>
          )}
          {counts.deleted > 0 && (
            <span className="commit-files-count commit-files-deleted" title="Deleted files">
              <MinusIcon size={12} />
              {counts.deleted} deleted
            </span>
          )}
        </span>
        <div className="commit-files-controls">
          <button
            type="button"
            className="commit-files-sort"
            title={asc ? 'Sorted A→Z (click for Z→A)' : 'Sorted Z→A (click for A→Z)'}
            aria-label="Toggle sort order"
            onClick={() => setAsc((v) => !v)}
          >
            <span className={`commit-files-sort-icon${asc ? '' : ' desc'}`}>
              <SortIcon size={14} />
            </span>
          </button>
          <div className="commit-files-viewswitch" role="group" aria-label="File view mode">
            {!viewAll && (
              <button
                type="button"
                className={effectiveMode === 'list' ? 'active' : ''}
                title="List view"
                aria-pressed={effectiveMode === 'list'}
                onClick={() => setMode('list')}
              >
                <ListIcon size={14} />
                List
              </button>
            )}
            <button
              type="button"
              className={effectiveMode === 'tree' ? 'active' : ''}
              title="Tree view"
              aria-pressed={effectiveMode === 'tree'}
              onClick={() => setMode('tree')}
            >
              <TreeIcon size={14} />
              Tree
            </button>
          </div>
          <label className="commit-files-viewall">
            <input
              type="checkbox"
              checked={viewAll}
              onChange={(event) => setViewAll(event.target.checked)}
            />
            View all files
          </label>
        </div>
      </div>
      {sorted === null ? (
        <p className="commit-files-empty">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="commit-files-empty">No file changes</p>
      ) : effectiveMode === 'tree' ? (
        <div className="commit-tree">
          <DirNode
            dir={buildTree(sorted)}
            depth={0}
            asc={asc}
            collapsed={collapsed}
            onToggle={toggleDir}
            onOpenFile={openFile}
            activePath={activePath}
          />
        </div>
      ) : (
        sorted.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            onOpen={() => openFile(file)}
            selected={file.path === activePath}
          />
        ))
      )}
    </div>
  );
}

/** Distinct files touched in the working tree (a path may be staged and unstaged). */
const countWorkingFiles = (status: WorkingStatus) =>
  new Set([...status.staged, ...status.unstaged].map((file) => file.path)).size;

interface CommitDetailProps {
  commit: CommitLogEntry;
  repoPath: string;
  /** Shared working-tree status, used to warn about uncommitted changes. */
  workingStatus: WorkingStatus | null;
  /** Return to the working-tree view (clears the selected commit). */
  onViewWorking: () => void;
  /** Reload history/refs after a reword rewrites the commit. */
  onCommitted: () => void;
  /** Select another commit by full hash (used by the parent-hash links). */
  onSelectCommit: (hash: string) => void;
  /** Open one of the commit's files in the center diff viewer. */
  onOpenDiff: (target: DiffTarget) => void;
  /** The diff target currently shown, so its row can be highlighted. */
  activeDiff: DiffTarget | null;
  onError?: (title: string, message: string) => void;
}

/** Read-only view of a selected historical commit; files load on demand. */
function CommitDetail({
  commit,
  repoPath,
  workingStatus,
  onViewWorking,
  onCommitted,
  onSelectCommit,
  onOpenDiff,
  activeDiff,
  onError,
}: CommitDetailProps) {
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [detail, setDetail] = useState<CommitDetailData | null>(null);
  // Exact number of commits a reword would rebase (this + descendants), from git;
  // null until it resolves.
  const [rebaseCount, setRebaseCount] = useState<number | null>(null);
  // Inline amend state: the message area is a display until clicked, then two
  // editable fields (subject + description) with save/cancel.
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setFiles(null);
    setDetail(null);
    setRebaseCount(null);
    // Selecting a different commit drops any in-progress edit.
    setEditing(false);
    void window.api.repo.commitFiles(repoPath, commit.hash).then((result) => {
      if (live) setFiles(result);
    });
    void window.api.repo.commitDetail(repoPath, commit.hash).then((result) => {
      if (live) setDetail(result);
    });
    void window.api.repo.rewordCount(repoPath, commit.hash).then((result) => {
      if (live) setRebaseCount(result);
    });
    return () => {
      live = false;
    };
  }, [repoPath, commit.hash]);

  const workingCount = workingStatus ? countWorkingFiles(workingStatus) : 0;
  // Fall back to the subject (already in hand) until the full message arrives.
  const message = detail?.message ?? commit.subject;
  const signed = detail ? isSigned(detail.signature) : false;

  const startEdit = () => {
    const parts = splitMessage(message);
    setSubject(parts.subject);
    setBody(parts.body);
    setEditing(true);
  };

  const save = useCallback(async () => {
    const next = joinMessage(subject, body);
    if (!next) {
      onError?.('Reword failed', 'Enter a commit message.');
      return;
    }
    // No-op if the message is unchanged — just leave edit mode.
    if (next === message.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const result = await window.api.repo.reword(repoPath, commit.hash, next);
    setSaving(false);
    if (result.status === 'error') {
      onError?.('Reword failed', result.message);
      return;
    }
    setEditing(false);
    // The reword rewrites this commit (and its descendants) to new hashes, so
    // reload history; the parent resolves the now-stale selection.
    onCommitted();
  }, [subject, body, message, repoPath, commit.hash, onCommitted, onError]);

  return (
    <aside className="commit-panel" aria-label="Commit details">
      <header className="commit-panel-header">Commit details</header>
      {workingCount > 0 && (
        <div className="commit-working-alert" role="status">
          <span className="commit-working-alert-text">
            {workingCount} {workingCount === 1 ? 'file' : 'files'} changed in the working directory
          </span>
          <button
            type="button"
            className="commit-working-alert-view"
            onClick={onViewWorking}
          >
            View
          </button>
        </div>
      )}
      <div className="commit-panel-body">
        <div className="commit-detail-hashline">
          {signed && (
            <span
              className="commit-detail-signed"
              title="Signed commit (verified GPG signature)"
            >
              <CertificateIcon size={14} />
            </span>
          )}
          <span className="commit-detail-hash">commit: {commit.shortHash}</span>
        </div>
        {editing ? (
          <div className="commit-amend">
            <div className="commit-amend-fields">
              <div className="commit-message-subject-row">
                <input
                  className="commit-amend-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Summary"
                  aria-label="Commit summary"
                  autoFocus
                />
                <SummaryCounter length={subject.length} />
              </div>
              <textarea
                className="commit-amend-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Description"
                aria-label="Commit description"
                rows={4}
              />
            </div>
            {rebaseCount !== null && rebaseCount > 1 && (
              <p className="commit-amend-warning" role="alert">
                Rewording this commit message will result in {rebaseCount} commits
                being rebased.
              </p>
            )}
            <div className="commit-amend-actions">
              <button
                type="button"
                className="commit-amend-cancel"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel Amend
              </button>
              <button
                type="button"
                className="commit-amend-save"
                onClick={() => void save()}
                disabled={saving || subject.trim().length === 0}
              >
                {saving ? 'Saving…' : 'Update Message'}
              </button>
            </div>
          </div>
        ) : (
          <div
            className="commit-detail-message tooltip-host"
            data-tooltip="Click to amend commit message"
            aria-label="Click to amend commit message"
            role="button"
            tabIndex={0}
            onClick={startEdit}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                startEdit();
              }
            }}
          >
            <span className="commit-detail-summary">{splitMessage(message).subject}</span>
            {splitMessage(message).body && (
              <span className="commit-detail-description">{splitMessage(message).body}</span>
            )}
          </div>
        )}
        <div className="commit-detail-meta">
          <img
            className="commit-detail-avatar"
            src={commit.authorAvatarUrl}
            alt=""
            width={36}
            height={36}
          />
          <div className="commit-detail-author">
            <span className="commit-detail-author-name">{commit.author}</span>
            <span className="commit-detail-author-date">
              <i>authored</i> {formatDate(commit.date)}
            </span>
          </div>
          {commit.parents.length > 0 && (
            <div className="commit-detail-parents">
              <div className="commit-detail-parents-label">
                {commit.parents.length > 1 ? 'Parents' : 'Parent'}
              </div>
              <div className="commit-detail-parents-hashes">
                {commit.parents.map((parent, index) => (
                  <div key={parent}>
                    <button
                      type="button"
                      className="commit-detail-parent-hash"
                      title={`Select parent ${parent}`}
                      onClick={() => onSelectCommit(parent)}
                    >
                      {parent.slice(0, 7)}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <CommitFiles
          repoPath={repoPath}
          hash={commit.hash}
          files={files}
          onOpenDiff={onOpenDiff}
          activeDiff={activeDiff}
        />
      </div>
    </aside>
  );
}

interface WorkingFileListProps {
  files: FileChange[];
  /** Flat list or folder tree; shared across both working sections. */
  mode: 'list' | 'tree';
  /** Ascending path sort? Shared across both working sections. */
  asc: boolean;
  emptyText: string;
  /** Per-file stage/unstage control. */
  action: (file: DisplayFile) => FileRowProps['action'];
  /** Open a file in the center diff viewer. */
  onOpenFile: (file: DisplayFile) => void;
  /** Path of the file currently shown in the diff viewer, if any. */
  activePath: string | null;
}

/**
 * A working-tree file list — the staged/unstaged sections share it. Renders a
 * flat sorted list or a collapsible folder tree, with per-file stage/unstage
 * actions and click-to-diff, mirroring the commit-detail file list's look.
 */
function WorkingFileList({
  files,
  mode,
  asc,
  emptyText,
  action,
  onOpenFile,
  activePath,
}: WorkingFileListProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleDir = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const sorted = useMemo(() => {
    const arr = [...files].sort((a, b) => a.path.localeCompare(b.path));
    if (!asc) arr.reverse();
    return arr;
  }, [files, asc]);

  if (sorted.length === 0) return <p className="commit-files-empty">{emptyText}</p>;
  if (mode === 'tree') {
    return (
      <div className="commit-tree">
        <DirNode
          dir={buildTree(sorted)}
          depth={0}
          asc={asc}
          collapsed={collapsed}
          onToggle={toggleDir}
          onOpenFile={onOpenFile}
          action={action}
          activePath={activePath}
        />
      </div>
    );
  }
  return (
    <>
      {sorted.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          action={action(file)}
          onOpen={() => onOpenFile(file)}
          selected={file.path === activePath}
        />
      ))}
    </>
  );
}

interface WorkingChangesProps {
  repoPath: string;
  /** The checked-out branch name, shown in the "N files changed on …" header. */
  branch?: string;
  /** Shared working-tree status (owned by RepoView); null while loading. */
  status: WorkingStatus | null;
  /** Push a fresh status up after stage/unstage/commit. */
  onStatusChange: (status: WorkingStatus) => void;
  /** Shared commit message, mirrored with the working row's inline input. */
  message: string;
  /** Update the shared commit message. */
  onMessageChange: (message: string) => void;
  /** Reload history/refs after a commit lands. */
  onCommitted: () => void;
  /** Open a working-tree file in the center diff viewer. */
  onOpenDiff: (target: DiffTarget) => void;
  /** The diff target currently shown, so its row can be highlighted. */
  activeDiff: DiffTarget | null;
  onError?: (title: string, message: string) => void;
}

/** Working-tree staging + commit, backed by real git status/add/reset/commit. */
function WorkingChanges({
  repoPath,
  branch,
  status,
  onStatusChange,
  message,
  onMessageChange,
  onCommitted,
  onOpenDiff,
  activeDiff,
  onError,
}: WorkingChangesProps) {
  const [busy, setBusy] = useState(false);
  // Shared across both sections: sort direction and list-vs-tree presentation.
  const [asc, setAsc] = useState(true);
  const [mode, setMode] = useState<'list' | 'tree'>('list');
  // Destructive actions route through the global confirm bar over the toolbar.
  const requestConfirm = useConfirm();
  // The share of the changes body given to the unstaged (top) section; the
  // staged (bottom) section takes the remainder. Dragged via the divider.
  const [topRatio, setTopRatio] = useState(0.5);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Staged rows diff the index against HEAD; unstaged rows the working tree
  // against the index. A row is active only when the open diff matches both its
  // path and its section's source.
  const stagedSource: DiffSource = { kind: 'staged' };
  const unstagedSource: DiffSource = { kind: 'unstaged' };
  const activePathFor = (source: DiffSource) =>
    activeDiff && sameSource(activeDiff.source, source) ? activeDiff.path : null;

  const stage = useCallback(
    async (file: string | null) => onStatusChange(await window.api.repo.stage(repoPath, file)),
    [repoPath, onStatusChange],
  );
  const unstage = useCallback(
    async (file: string | null) => onStatusChange(await window.api.repo.unstage(repoPath, file)),
    [repoPath, onStatusChange],
  );

  // Stage a single file while keeping the diff viewer on a useful target: when
  // the file being staged is the one currently open, advance the viewer to the
  // next unstaged file (in the list's sort order) so inspection flows down the
  // list. Staging the last unstaged file follows it into the staged section
  // instead, so its now-staged diff stays on screen.
  const stageFile = useCallback(
    async (file: DisplayFile) => {
      const unstaged = status?.unstaged ?? [];
      const viewing =
        activeDiff &&
        sameSource(activeDiff.source, { kind: 'unstaged' }) &&
        activeDiff.path === file.path;
      let next: DiffTarget | null = null;
      if (viewing) {
        const order = [...unstaged].sort((a, b) => a.path.localeCompare(b.path));
        if (!asc) order.reverse();
        const idx = order.findIndex((f) => f.path === file.path);
        const following = idx >= 0 ? order[idx + 1] : undefined;
        next = following
          ? { source: { kind: 'unstaged' }, path: following.path, status: following.status ?? 'modified' }
          : { source: { kind: 'staged' }, path: file.path, status: file.status ?? 'modified' };
      }
      onStatusChange(await window.api.repo.stage(repoPath, file.path));
      if (next) onOpenDiff(next);
    },
    [repoPath, status, asc, activeDiff, onStatusChange, onOpenDiff],
  );

  const discardAll = useCallback(() => {
    requestConfirm({
      message: 'Discard all changes? This cannot be undone.',
      actions: [
        {
          label: 'Discard all',
          busyLabel: 'Discarding…',
          tone: 'danger',
          onClick: async () =>
            onStatusChange(await window.api.repo.discardAll(repoPath)),
        },
      ],
    });
  }, [requestConfirm, repoPath, onStatusChange]);

  const commit = useCallback(async () => {
    setBusy(true);
    const result = await window.api.repo.commit(repoPath, message);
    setBusy(false);
    if (result.status === 'error') {
      onError?.('Commit failed', result.message);
      return;
    }
    onMessageChange('');
    onStatusChange(await window.api.repo.status(repoPath));
    onCommitted();
  }, [repoPath, message, onMessageChange, onStatusChange, onCommitted, onError]);

  // Drag the divider: convert the pointer's Y within the body to a top/bottom
  // split ratio, clamped so neither section fully collapses.
  const startVSplit = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const el = bodyRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = (ev.clientY - rect.top) / rect.height;
      setTopRatio(Math.min(0.85, Math.max(0.15, ratio)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('is-row-resizing');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.classList.add('is-row-resizing');
  }, []);

  if (status === null) {
    return (
      <aside className="commit-panel" aria-label="Commit changes">
        <header className="commit-panel-header">Commit changes</header>
        <div className="commit-panel-empty">
          <p>Loading changes…</p>
        </div>
      </aside>
    );
  }

  const { staged, unstaged } = status;
  const changedCount = countWorkingFiles(status);
  const hasChanges = changedCount > 0;
  // The shared message is one string; split it into the subject + description
  // fields and recompose on edit so the working row's inline input stays mirrored.
  const { subject, body } = splitMessage(message);
  const canCommit = staged.length > 0 && subject.trim().length > 0 && !busy;

  return (
    <aside className="commit-panel" aria-label="Commit changes">
      <header className="commit-panel-header commit-changes-header">
        {hasChanges && (
          <button
            type="button"
            className="commit-discard-btn tooltip-host"
            data-tooltip="Discard all changes"
            aria-label="Discard all changes"
            onClick={discardAll}
          >
            <TrashIcon size={16} />
          </button>
        )}
        <span className="commit-changes-summary">
          {changedCount} {changedCount === 1 ? 'file' : 'files'} changed
          {branch && (
            <>
              {' '}
              on <strong>{branch}</strong>
            </>
          )}
        </span>
      </header>

      <div className="commit-changes-controls">
        <button
          type="button"
          className="commit-files-sort"
          title={asc ? 'Sorted A→Z (click for Z→A)' : 'Sorted Z→A (click for A→Z)'}
          aria-label="Toggle sort order"
          onClick={() => setAsc((v) => !v)}
        >
          <span className={`commit-files-sort-icon${asc ? '' : ' desc'}`}>
            <SortIcon size={14} />
          </span>
        </button>
        <div className="commit-files-viewswitch" role="group" aria-label="File view mode">
          <button
            type="button"
            className={mode === 'list' ? 'active' : ''}
            title="List view"
            aria-pressed={mode === 'list'}
            onClick={() => setMode('list')}
          >
            <ListIcon size={14} />
            List
          </button>
          <button
            type="button"
            className={mode === 'tree' ? 'active' : ''}
            title="Tree view"
            aria-pressed={mode === 'tree'}
            onClick={() => setMode('tree')}
          >
            <TreeIcon size={14} />
            Tree
          </button>
        </div>
      </div>

      <div className="commit-changes-body" ref={bodyRef}>
        <section className="commit-changes-section" style={{ flexGrow: topRatio }}>
          <div className="commit-files-header">
            <span className="commit-files-title">Unstaged Files · {unstaged.length}</span>
            {unstaged.length > 0 && (
              <button
                type="button"
                className="pill-btn pill-btn-green commit-files-bulk"
                onClick={() => void stage(null)}
              >
                Stage All Changes
              </button>
            )}
          </div>
          <div className="commit-changes-scroll">
            <WorkingFileList
              files={unstaged}
              mode={mode}
              asc={asc}
              emptyText="No unstaged changes"
              action={(file) => ({
                label: 'Stage',
                title: 'Stage file',
                variant: 'green',
                onClick: () => void stageFile(file),
              })}
              onOpenFile={(file) =>
                onOpenDiff({
                  source: unstagedSource,
                  path: file.path,
                  status: file.status ?? 'modified',
                })
              }
              activePath={activePathFor(unstagedSource)}
            />
          </div>
        </section>

        <div
          className="commit-split-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize unstaged and staged sections"
          onPointerDown={startVSplit}
        />

        <section className="commit-changes-section" style={{ flexGrow: 1 - topRatio }}>
          <div className="commit-files-header">
            <span className="commit-files-title">Staged Files · {staged.length}</span>
            {staged.length > 0 && (
              <button
                type="button"
                className="pill-btn pill-btn-red commit-files-bulk"
                onClick={() => void unstage(null)}
              >
                Unstage All Changes
              </button>
            )}
          </div>
          <div className="commit-changes-scroll">
            <WorkingFileList
              files={staged}
              mode={mode}
              asc={asc}
              emptyText="Nothing staged"
              action={(file) => ({
                label: 'Unstage',
                title: 'Unstage file',
                variant: 'red',
                onClick: () => void unstage(file.path),
              })}
              onOpenFile={(file) =>
                onOpenDiff({
                  source: stagedSource,
                  path: file.path,
                  status: file.status ?? 'modified',
                })
              }
              activePath={activePathFor(stagedSource)}
            />
          </div>
        </section>
      </div>

      <div className="commit-message-box">
        <div className="commit-message-fields">
          <div className="commit-message-subject-row">
            <input
              className="commit-message-subject"
              placeholder="Summary"
              aria-label="Commit summary"
              value={subject}
              onChange={(event) => onMessageChange(composeMessage(event.target.value, body))}
            />
            <SummaryCounter length={subject.length} />
          </div>
          <textarea
            className="commit-message-description"
            placeholder="Description"
            aria-label="Commit description"
            value={body}
            onChange={(event) => onMessageChange(composeMessage(subject, event.target.value))}
            rows={3}
          />
        </div>
        <button
          type="button"
          className="commit-submit"
          disabled={!canCommit}
          onClick={() => void commit()}
        >
          Commit{staged.length > 0 ? ` (${staged.length})` : ''}
        </button>
      </div>
    </aside>
  );
}

interface CommitPanelProps {
  /** The selected historical commit, or null for the working-tree view. */
  commit: CommitLogEntry | null;
  repoPath: string;
  /** The checked-out branch name, shown in the working-tree changes header. */
  branch?: string;
  /** Shared working-tree status; null while loading. */
  workingStatus: WorkingStatus | null;
  /** Push a fresh working-tree status up after stage/unstage/commit. */
  onWorkingStatusChange: (status: WorkingStatus) => void;
  /** Shared commit message, mirrored with the working row's inline input. */
  commitMessage: string;
  /** Update the shared commit message. */
  onCommitMessageChange: (message: string) => void;
  onCommitted: () => void;
  /** Return to the working-tree view from the commit detail alert bar. */
  onViewWorking: () => void;
  /** Select another commit by full hash (used by the parent-hash links). */
  onSelectCommit: (hash: string) => void;
  /** Open a file in the center diff viewer. */
  onOpenDiff: (target: DiffTarget) => void;
  /** The diff target currently shown, so its file row can be highlighted. */
  activeDiff: DiffTarget | null;
  onError?: (title: string, message: string) => void;
}

/**
 * Right column. Two states: a read-only detail view when a past commit is
 * selected, otherwise the working-tree staging + commit UI.
 */
export function CommitPanel({
  commit,
  repoPath,
  branch,
  workingStatus,
  onWorkingStatusChange,
  commitMessage,
  onCommitMessageChange,
  onCommitted,
  onViewWorking,
  onSelectCommit,
  onOpenDiff,
  activeDiff,
  onError,
}: CommitPanelProps) {
  return commit ? (
    <CommitDetail
      commit={commit}
      repoPath={repoPath}
      workingStatus={workingStatus}
      onViewWorking={onViewWorking}
      onCommitted={onCommitted}
      onSelectCommit={onSelectCommit}
      onOpenDiff={onOpenDiff}
      activeDiff={activeDiff}
      onError={onError}
    />
  ) : (
    <WorkingChanges
      repoPath={repoPath}
      branch={branch}
      status={workingStatus}
      onStatusChange={onWorkingStatusChange}
      message={commitMessage}
      onMessageChange={onCommitMessageChange}
      onCommitted={onCommitted}
      onOpenDiff={onOpenDiff}
      activeDiff={activeDiff}
      onError={onError}
    />
  );
}
