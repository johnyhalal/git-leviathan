import { useEffect, useState } from 'react';
import type { DiffSource, FileDiff, FileStatus } from '../../../../types/ipc';
import {
  ChevronDownIcon,
  CloseIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
} from '../../../../../assets/icons';

/** The file a diff is opened for: its path, status, and where the diff is taken from. */
export interface DiffTarget {
  source: DiffSource;
  path: string;
  status: FileStatus;
}

/** Per-status glyph, mirroring the file-list icons in the commit panel. */
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

const baseName = (path: string) => path.split('/').pop() ?? path;
const dirName = (path: string) => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash + 1);
};

type ViewMode = 'diff' | 'file';

interface DiffViewProps {
  repoPath: string;
  target: DiffTarget;
  onClose: () => void;
}

/**
 * The center-column file viewer that swaps in over the commit list when a file
 * is selected. A header (path + close) sits over a secondary nav (a file/diff
 * mode switch and prev/next steppers) over the line-numbered body, which shows
 * either the parsed unified diff or the file's full content.
 */
export function DiffView({ repoPath, target, onClose }: DiffViewProps) {
  const { source, path, status } = target;
  const [mode, setMode] = useState<ViewMode>('diff');
  const [diff, setDiff] = useState<FileDiff | null>(null);
  // The full-file content for "file view", fetched lazily the first time that
  // mode is entered; null until then / while loading.
  const [content, setContent] = useState<string[] | null>(null);

  // Opening a different file (or moving between diff sources) resets everything.
  useEffect(() => {
    setMode('diff');
    setDiff(null);
    setContent(null);
    let live = true;
    void window.api.repo.fileDiff(repoPath, source, path).then((result) => {
      if (live) setDiff(result);
    });
    return () => {
      live = false;
    };
  }, [repoPath, source, path]);

  useEffect(() => {
    if (mode !== 'file' || content !== null) return;
    let live = true;
    void window.api.repo.fileContent(repoPath, source, path).then((lines) => {
      if (live) setContent(lines);
    });
    return () => {
      live = false;
    };
  }, [mode, content, repoPath, source, path]);

  return (
    <div className="diff-view">
      <header className="diff-header">
        <div className="diff-header-file">
          <span className={`commit-file-status status-${status}`} title={status}>
            {statusIcon(status)}
          </span>
          <span className="diff-header-path" title={path}>
            {dirName(path) && <span className="diff-header-dir">{dirName(path)}</span>}
            <span className="diff-header-name">{baseName(path)}</span>
          </span>
        </div>
        <button
          type="button"
          className="diff-close"
          title="Close diff"
          aria-label="Close diff"
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="diff-subnav">
        <div className="diff-viewswitch" role="group" aria-label="View mode">
          <button
            type="button"
            className={mode === 'file' ? 'active' : ''}
            aria-pressed={mode === 'file'}
            onClick={() => setMode('file')}
          >
            File
          </button>
          <button
            type="button"
            className={mode === 'diff' ? 'active' : ''}
            aria-pressed={mode === 'diff'}
            onClick={() => setMode('diff')}
          >
            Diff
          </button>
        </div>
        <div className="diff-steppers">
          <button
            type="button"
            className="diff-step diff-step-prev"
            title="Previous difference"
            aria-label="Previous difference"
          >
            <ChevronDownIcon size={14} />
          </button>
          <button
            type="button"
            className="diff-step diff-step-next"
            title="Next difference"
            aria-label="Next difference"
          >
            <ChevronDownIcon size={14} />
          </button>
        </div>
      </div>

      <div className="diff-body">
        {mode === 'diff' ? (
          <DiffBody diff={diff} />
        ) : (
          <FileBody content={content} />
        )}
      </div>
    </div>
  );
}

/** The unified-diff rendering: two line-number gutters and a marked code column. */
function DiffBody({ diff }: { diff: FileDiff | null }) {
  if (diff === null) return <p className="diff-empty">Loading…</p>;
  if (diff.binary) return <p className="diff-empty">Binary file — no diff to show.</p>;
  if (diff.lines.length === 0) return <p className="diff-empty">No changes.</p>;

  return (
    <div className="diff-lines" role="table">
      {diff.lines.map((line, index) => {
        if (line.kind === 'hunk') {
          return (
            <div key={index} className="diff-line diff-line-hunk" role="row">
              <span className="diff-hunk-text">{line.text}</span>
            </div>
          );
        }
        const sign = line.kind === 'add' ? '+' : line.kind === 'delete' ? '−' : '';
        return (
          <div key={index} className={`diff-line diff-line-${line.kind}`} role="row">
            <span className="diff-gutter">{line.oldLine ?? ''}</span>
            <span className="diff-gutter">{line.newLine ?? ''}</span>
            <span className="diff-sign" aria-hidden="true">
              {sign}
            </span>
            <span className="diff-code">{line.text}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The full-file rendering: a single line-number gutter and the content column. */
function FileBody({ content }: { content: string[] | null }) {
  if (content === null) return <p className="diff-empty">Loading…</p>;
  if (content.length === 0) return <p className="diff-empty">Empty or binary file.</p>;

  return (
    <div className="diff-lines diff-lines-file" role="table">
      {content.map((line, index) => (
        <div key={index} className="diff-line diff-line-context" role="row">
          <span className="diff-gutter">{index + 1}</span>
          <span className="diff-code">{line}</span>
        </div>
      ))}
    </div>
  );
}
