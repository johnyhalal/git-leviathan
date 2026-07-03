import { useCallback, useEffect, useState } from 'react';
import type {
  CommitLogEntry,
  FileChange,
  FileStatus,
  WorkingStatus,
} from '../../../../types/ipc';

const STATUS_LETTER: Record<FileStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
};

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

interface FileRowProps {
  file: FileChange;
  /** Optional stage/unstage control; omitted in the read-only detail view. */
  action?: { label: string; title: string; onClick: () => void };
}

function FileRow({ file, action }: FileRowProps) {
  return (
    <div className="commit-file">
      <span className={`commit-file-status status-${file.status}`} title={file.status}>
        {STATUS_LETTER[file.status]}
      </span>
      <span className="commit-file-path" title={file.path}>
        <span className="commit-file-name">{baseName(file.path)}</span>
        {dirName(file.path) && (
          <span className="commit-file-dir">{dirName(file.path)}</span>
        )}
      </span>
      {action && (
        <button
          type="button"
          className="commit-file-action"
          title={action.title}
          aria-label={action.title}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Read-only view of a selected historical commit; files load on demand. */
function CommitDetail({ commit, repoPath }: { commit: CommitLogEntry; repoPath: string }) {
  const [files, setFiles] = useState<FileChange[] | null>(null);

  useEffect(() => {
    let live = true;
    setFiles(null);
    void window.api.repo.commitFiles(repoPath, commit.hash).then((result) => {
      if (live) setFiles(result);
    });
    return () => {
      live = false;
    };
  }, [repoPath, commit.hash]);

  return (
    <aside className="commit-panel" aria-label="Commit details">
      <header className="commit-panel-header">Commit details</header>
      <div className="commit-panel-body">
        <p className="commit-detail-message">{commit.subject}</p>
        <dl className="commit-detail-meta">
          <div className="commit-detail-line">
            <dt>Commit</dt>
            <dd className="commit-detail-hash">{commit.shortHash}</dd>
          </div>
          <div className="commit-detail-line">
            <dt>Author</dt>
            <dd>{commit.author}</dd>
          </div>
          <div className="commit-detail-line">
            <dt>Date</dt>
            <dd>{formatDate(commit.date)}</dd>
          </div>
        </dl>
        <div className="commit-files">
          <div className="commit-files-header">
            <span className="commit-files-title">
              {files === null ? 'Files changed' : `Files changed · ${files.length}`}
            </span>
          </div>
          {files === null ? (
            <p className="commit-files-empty">Loading…</p>
          ) : files.length === 0 ? (
            <p className="commit-files-empty">No file changes</p>
          ) : (
            files.map((file) => <FileRow key={file.path} file={file} />)
          )}
        </div>
      </div>
    </aside>
  );
}

interface FilesSectionProps {
  title: string;
  files: FileChange[];
  emptyText: string;
  /** Bulk action for the whole section (stage all / unstage all). */
  bulk?: { label: string; onClick: () => void };
  /** Per-file action builder. */
  action: (file: FileChange) => FileRowProps['action'];
}

function FilesSection({ title, files, emptyText, bulk, action }: FilesSectionProps) {
  return (
    <div className="commit-files">
      <div className="commit-files-header">
        <span className="commit-files-title">
          {title} · {files.length}
        </span>
        {bulk && files.length > 0 && (
          <button type="button" className="commit-files-bulk" onClick={bulk.onClick}>
            {bulk.label}
          </button>
        )}
      </div>
      {files.length === 0 ? (
        <p className="commit-files-empty">{emptyText}</p>
      ) : (
        files.map((file) => <FileRow key={file.path} file={file} action={action(file)} />)
      )}
    </div>
  );
}

interface WorkingChangesProps {
  repoPath: string;
  /** Reload history/refs after a commit lands. */
  onCommitted: () => void;
  onError?: (title: string, message: string) => void;
}

/** Working-tree staging + commit, backed by real git status/add/reset/commit. */
function WorkingChanges({ repoPath, onCommitted, onError }: WorkingChangesProps) {
  const [status, setStatus] = useState<WorkingStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setStatus(null);
    void window.api.repo.status(repoPath).then((result) => {
      if (live) setStatus(result);
    });
    return () => {
      live = false;
    };
  }, [repoPath]);

  const stage = useCallback(
    async (file: string | null) => setStatus(await window.api.repo.stage(repoPath, file)),
    [repoPath],
  );
  const unstage = useCallback(
    async (file: string | null) => setStatus(await window.api.repo.unstage(repoPath, file)),
    [repoPath],
  );

  const commit = useCallback(async () => {
    setBusy(true);
    const result = await window.api.repo.commit(repoPath, message);
    setBusy(false);
    if (result.status === 'error') {
      onError?.('Commit failed', result.message);
      return;
    }
    setMessage('');
    setStatus(await window.api.repo.status(repoPath));
    onCommitted();
  }, [repoPath, message, onCommitted, onError]);

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
  const nothing = staged.length === 0 && unstaged.length === 0;
  const canCommit = staged.length > 0 && message.trim().length > 0 && !busy;

  return (
    <aside className="commit-panel" aria-label="Commit changes">
      <header className="commit-panel-header">Commit changes</header>

      <div className="commit-panel-body">
        {nothing ? (
          <div className="commit-panel-empty">
            <p>No changes to commit</p>
          </div>
        ) : (
          <>
            <FilesSection
              title="Staged"
              files={staged}
              emptyText="Nothing staged"
              bulk={{ label: 'Unstage all', onClick: () => void unstage(null) }}
              action={(file) => ({
                label: '−',
                title: 'Unstage file',
                onClick: () => void unstage(file.path),
              })}
            />
            <FilesSection
              title="Changes"
              files={unstaged}
              emptyText="No unstaged changes"
              bulk={{ label: 'Stage all', onClick: () => void stage(null) }}
              action={(file) => ({
                label: '+',
                title: 'Stage file',
                onClick: () => void stage(file.path),
              })}
            />
          </>
        )}
      </div>

      <div className="commit-message-box">
        <textarea
          className="commit-message-input"
          placeholder="Commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
        />
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
  onCommitted: () => void;
  onError?: (title: string, message: string) => void;
}

/**
 * Right column. Two states: a read-only detail view when a past commit is
 * selected, otherwise the working-tree staging + commit UI.
 */
export function CommitPanel({ commit, repoPath, onCommitted, onError }: CommitPanelProps) {
  return commit ? (
    <CommitDetail commit={commit} repoPath={repoPath} />
  ) : (
    <WorkingChanges repoPath={repoPath} onCommitted={onCommitted} onError={onError} />
  );
}
