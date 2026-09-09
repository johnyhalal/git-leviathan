import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BlameLine,
  CommitLogEntry,
  DiffSource,
  FileBlame,
  FileDiff,
  FileStatus,
  WorkingStatus,
} from '../../../../types/ipc';
import { highlightBuffer, highlightLine, languageForPath } from './syntax';
import { authorColor } from './authorColor';
import { useConfirm } from '../ConfirmBar';
import {
  ChevronDownIcon,
  CloseIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
} from '../../../../../assets/icons';

/**
 * The file a diff is opened for: its path, status, and where the diff is taken
 * from. `view` optionally opens the viewer directly in a given mode (e.g. a
 * context menu launching straight into blame or history).
 */
export interface DiffTarget {
  source: DiffSource;
  path: string;
  status: FileStatus;
  /** Initial view mode; defaults to `diff`. */
  view?: ViewMode;
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

const shortDateFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
/** Compact date for the blame gutter / history rows; falls back to the raw ISO. */
function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : shortDateFmt.format(date);
}

export type ViewMode = 'diff' | 'file' | 'blame' | 'history';

interface DiffViewProps {
  repoPath: string;
  target: DiffTarget;
  onClose: () => void;
  /** Push a fresh working-tree status up after a hunk is staged or discarded. */
  onWorkingStatusChange?: (status: WorkingStatus) => void;
}

/**
 * The center-column file viewer that swaps in over the commit list when a file
 * is selected. A header (path + close) sits over a secondary nav (a
 * file/diff/blame/history mode switch, the viewed-revision label, and
 * older/newer revision steppers) over the body.
 *
 * The viewer tracks a `rev` — the revision the file is shown at. It starts at
 * the commit the file was opened from (or the working tree for a staged/unstaged
 * change), and the history timeline, the blame view, and the revision steppers
 * all move it through the file's own history so the user can step through
 * revisions without leaving the file.
 */
export function DiffView({ repoPath, target, onClose, onWorkingStatusChange }: DiffViewProps) {
  const { source, path, status } = target;
  const lang = useMemo(() => languageForPath(path), [path]);
  const requestConfirm = useConfirm();
  const [mode, setMode] = useState<ViewMode>(target.view ?? 'diff');

  // The revision the file is viewed at: '' means the working tree / the original
  // source (a staged/unstaged/range change), a hash means that commit. Opening
  // from a commit's file starts there so the stepper and blame have an anchor.
  const initialRev = source.kind === 'commit' ? source.hash : '';
  const [rev, setRev] = useState(initialRev);

  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [content, setContent] = useState<string[] | null>(null);
  const [blame, setBlame] = useState<FileBlame | null>(null);
  // The file's history (commits that touched it), for the timeline + steppers.
  // Fetched once per file; null while loading.
  const [history, setHistory] = useState<CommitLogEntry[] | null>(null);

  // The diff source for the *viewed* revision: the original source at the
  // working tree, otherwise that commit against its parent.
  const viewSource = useMemo<DiffSource>(
    () => (rev ? { kind: 'commit', hash: rev } : source),
    [rev, source],
  );

  // Opening a different file resets everything back to its initial revision.
  useEffect(() => {
    setMode(target.view ?? 'diff');
    setRev(source.kind === 'commit' ? source.hash : '');
    setHistory(null);
  }, [repoPath, path, source, target.view]);

  // The viewed revision (or the file) changed: rev-dependent views are stale.
  useEffect(() => {
    setDiff(null);
    setContent(null);
    setBlame(null);
  }, [repoPath, path, viewSource]);

  // Load the file's history once per file — it powers both the timeline and the
  // older/newer steppers, so it's fetched eagerly rather than only in history mode.
  useEffect(() => {
    let live = true;
    setHistory(null);
    void window.api.repo.fileLog(repoPath, path).then((commits) => {
      if (live) setHistory(commits);
    });
    return () => {
      live = false;
    };
  }, [repoPath, path]);

  useEffect(() => {
    if (mode !== 'diff' || diff !== null) return;
    let live = true;
    void window.api.repo.fileDiff(repoPath, viewSource, path).then((result) => {
      if (live) setDiff(result);
    });
    return () => {
      live = false;
    };
  }, [mode, diff, repoPath, viewSource, path]);

  useEffect(() => {
    if (mode !== 'file' || content !== null) return;
    let live = true;
    void window.api.repo.fileContent(repoPath, viewSource, path).then((lines) => {
      if (live) setContent(lines);
    });
    return () => {
      live = false;
    };
  }, [mode, content, repoPath, viewSource, path]);

  useEffect(() => {
    if (mode !== 'blame' || blame !== null) return;
    let live = true;
    void window.api.repo.fileBlame(repoPath, rev, path).then((result) => {
      if (live) setBlame(result);
    });
    return () => {
      live = false;
    };
  }, [mode, blame, repoPath, rev, path]);

  // Hunk-level actions only apply when the *original* working-tree change is in
  // view (rev === '' and a staged/unstaged source) — not a historical revision.
  const atOriginal = rev === '';
  const canStageHunks = atOriginal && source.kind === 'unstaged';
  const canUnstageHunks = atOriginal && source.kind === 'staged';
  const afterHunk = useCallback(
    async (nextStatus: WorkingStatus) => {
      onWorkingStatusChange?.(nextStatus);
      const fresh = await window.api.repo.fileDiff(repoPath, source, path);
      if (fresh.lines.length === 0) onClose();
      else setDiff(fresh);
    },
    [onWorkingStatusChange, repoPath, source, path, onClose],
  );
  const stageHunk = useCallback(
    async (hunkIndex: number) => {
      await afterHunk(await window.api.repo.stageHunk(repoPath, path, hunkIndex));
    },
    [afterHunk, repoPath, path],
  );
  const unstageHunk = useCallback(
    async (hunkIndex: number) => {
      await afterHunk(await window.api.repo.unstageHunk(repoPath, path, hunkIndex));
    },
    [afterHunk, repoPath, path],
  );
  const discardHunk = useCallback(
    (hunkIndex: number) => {
      requestConfirm({
        message: 'Discard this hunk? This cannot be undone.',
        actions: [
          {
            label: 'Discard hunk',
            busyLabel: 'Discarding…',
            tone: 'danger',
            onClick: async () => {
              await afterHunk(await window.api.repo.discardHunk(repoPath, path, hunkIndex));
            },
          },
        ],
      });
    },
    [requestConfirm, afterHunk, repoPath, path],
  );

  // Revision stepping through the file's history list. Index of the viewed rev
  // (-1 when at the working tree). "Older" walks down the list; "newer" walks up,
  // stepping back to the working tree when the file was opened from there.
  const revList = history ?? [];
  const revIndex = rev === '' ? -1 : revList.findIndex((commit) => commit.hash === rev);
  const opensFromWorking = source.kind !== 'commit';
  const olderRev = (): string | null => {
    if (rev === '') return revList[0]?.hash ?? null;
    if (revIndex === -1) return null;
    return revList[revIndex + 1]?.hash ?? null;
  };
  const newerRev = (): string | null => {
    if (rev === '') return null;
    if (revIndex <= 0) return opensFromWorking ? '' : null;
    return revList[revIndex - 1]?.hash ?? null;
  };
  const older = olderRev();
  const newer = newerRev();

  // Jump to a specific revision (from the history list or a blame block) and show
  // its change to the file.
  const pickRev = (hash: string) => {
    setRev(hash);
    if (mode === 'history') setMode('diff');
  };

  // A short label for the viewed revision, shown between the mode switch and the
  // steppers.
  const revLabel =
    rev === ''
      ? source.kind === 'range'
        ? 'Range'
        : 'Working tree'
      : revList.find((commit) => commit.hash === rev)?.shortHash ?? rev.slice(0, 7);

  return (
    <div className="diff-view">
      <header className="diff-header">
        <div className="diff-header-file">
          <span className={`commit-file-status status-${status} tooltip-host`} data-tooltip={status}>
            {statusIcon(status)}
          </span>
          <span className="diff-header-path tooltip-host" data-tooltip={path}>
            {dirName(path) && <span className="diff-header-dir">{dirName(path)}</span>}
            <span className="diff-header-name">{baseName(path)}</span>
          </span>
        </div>
        <button
          type="button"
          className="diff-close tooltip-host"
          data-tooltip="Close diff"
          aria-label="Close diff"
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="diff-subnav">
        <span className="diff-revlabel tooltip-host" data-tooltip="Viewed revision">
          {revLabel}
        </span>
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
          <button
            type="button"
            className={mode === 'blame' ? 'active' : ''}
            aria-pressed={mode === 'blame'}
            onClick={() => setMode('blame')}
          >
            Blame
          </button>
          <button
            type="button"
            className={mode === 'history' ? 'active' : ''}
            aria-pressed={mode === 'history'}
            onClick={() => setMode('history')}
          >
            History
          </button>
        </div>
        <div className="diff-steppers">
          <button
            type="button"
            className="diff-step diff-step-prev tooltip-host"
            data-tooltip="Older revision"
            aria-label="Older revision"
            disabled={older === null}
            onClick={() => older !== null && setRev(older)}
          >
            <ChevronDownIcon size={14} />
          </button>
          <button
            type="button"
            className="diff-step diff-step-next tooltip-host"
            data-tooltip="Newer revision"
            aria-label="Newer revision"
            disabled={newer === null}
            onClick={() => newer !== null && setRev(newer)}
          >
            <ChevronDownIcon size={14} />
          </button>
        </div>
      </div>

      <div className="diff-body">
        {mode === 'diff' ? (
          <DiffBody
            diff={diff}
            lang={lang}
            onStageHunk={canStageHunks ? stageHunk : undefined}
            onDiscardHunk={canStageHunks ? discardHunk : undefined}
            onUnstageHunk={canUnstageHunks ? unstageHunk : undefined}
          />
        ) : mode === 'file' ? (
          <FileBody content={content} lang={lang} />
        ) : mode === 'blame' ? (
          <BlameBody blame={blame} lang={lang} onPickRev={pickRev} />
        ) : (
          <HistoryBody history={history} rev={rev} onPickRev={pickRev} />
        )}
      </div>
    </div>
  );
}

/** The unified-diff rendering: two line-number gutters and a marked code column.
 * Each line is highlighted on its own — add/delete/context lines don't form a
 * contiguous program, so a whole-hunk highlight would be misleading. */
function DiffBody({
  diff,
  lang,
  onStageHunk,
  onDiscardHunk,
  onUnstageHunk,
}: {
  diff: FileDiff | null;
  lang: string | null;
  /** Stage the hunk at this index (unstaged view); paired with onDiscardHunk. */
  onStageHunk?: (hunkIndex: number) => void;
  onDiscardHunk?: (hunkIndex: number) => void;
  /** Unstage the hunk at this index (staged view). */
  onUnstageHunk?: (hunkIndex: number) => void;
}) {
  if (diff === null) return <p className="diff-empty">Loading…</p>;
  if (diff.binary) return <p className="diff-empty">Binary file — no diff to show.</p>;
  if (diff.lines.length === 0) return <p className="diff-empty">No changes.</p>;

  const hunkActions = (onStageHunk && onDiscardHunk) || onUnstageHunk;
  // Hunks are numbered in diff order, matching how the main process re-derives
  // them for `stageHunk`/`discardHunk`; count headers seen so far as we render.
  let hunkIndex = -1;
  return (
    <div className="diff-lines" role="table">
      {diff.lines.map((line, index) => {
        if (line.kind === 'hunk') {
          hunkIndex += 1;
          const thisHunk = hunkIndex;
          const rangeEnd = line.text.indexOf('@@', 2);
          const hunkText = rangeEnd === -1 ? line.text : line.text.slice(0, rangeEnd + 2);
          return (
            <div key={index} className="diff-line diff-line-hunk" role="row">
              <span className="diff-hunk-text">{hunkText}</span>
              {hunkActions && (
                <span className="diff-hunk-actions">
                  {onUnstageHunk ? (
                    <button
                      type="button"
                      className="pill-btn pill-btn-red diff-hunk-btn tooltip-host"
                      data-tooltip="Unstage this hunk"
                      onClick={() => onUnstageHunk(thisHunk)}
                    >
                      Unstage Hunk
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="pill-btn pill-btn-red diff-hunk-btn tooltip-host"
                        data-tooltip="Discard this hunk"
                        onClick={() => onDiscardHunk?.(thisHunk)}
                      >
                        Discard Hunk
                      </button>
                      <button
                        type="button"
                        className="pill-btn pill-btn-green diff-hunk-btn tooltip-host"
                        data-tooltip="Stage this hunk"
                        onClick={() => onStageHunk?.(thisHunk)}
                      >
                        Stage Hunk
                      </button>
                    </>
                  )}
                </span>
              )}
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
            <span
              className="diff-code hljs"
              dangerouslySetInnerHTML={{ __html: highlightLine(line.text, lang) }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** The full-file rendering: a single line-number gutter and the content column.
 * The whole buffer is highlighted at once so multi-line constructs stay intact,
 * then split back into per-line markup aligned with the content lines. */
function FileBody({ content, lang }: { content: string[] | null; lang: string | null }) {
  const html = useMemo(
    () => (content ? highlightBuffer(content.join('\n'), lang) : []),
    [content, lang],
  );

  if (content === null) return <p className="diff-empty">Loading…</p>;
  if (content.length === 0) return <p className="diff-empty">Empty or binary file.</p>;

  return (
    <div className="diff-lines diff-lines-file" role="table">
      {content.map((_, index) => (
        <div key={index} className="diff-line diff-line-context" role="row">
          <span className="diff-gutter">{index + 1}</span>
          <span
            className="diff-code hljs"
            dangerouslySetInnerHTML={{ __html: html[index] ?? '' }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The blame rendering: each line carries the commit that last touched it. Lines
 * are grouped into runs by that commit — the commit/author annotation shows only
 * on the first line of a run, and each run is tinted and bordered in the
 * author's color. Clicking a run jumps to that commit's change to the file. The
 * content column is highlighted as one buffer so multi-line constructs stay
 * intact, matching the full-file view.
 */
function BlameBody({
  blame,
  lang,
  onPickRev,
}: {
  blame: FileBlame | null;
  lang: string | null;
  onPickRev: (hash: string) => void;
}) {
  const html = useMemo(
    () => (blame ? highlightBuffer(blame.lines.map((line) => line.content).join('\n'), lang) : []),
    [blame, lang],
  );

  if (blame === null) return <p className="diff-empty">Loading…</p>;
  if (blame.lines.length === 0)
    return <p className="diff-empty">No blame — binary, empty, or missing at this revision.</p>;

  return (
    <div className="blame-lines" role="table">
      {blame.lines.map((line, index) => {
        const groupStart = index === 0 || blame.lines[index - 1].hash !== line.hash;
        return (
          <BlameRow
            key={index}
            line={line}
            groupStart={groupStart}
            html={html[index] ?? ''}
            onPickRev={onPickRev}
          />
        );
      })}
    </div>
  );
}

function BlameRow({
  line,
  groupStart,
  html,
  onPickRev,
}: {
  line: BlameLine;
  groupStart: boolean;
  html: string;
  onPickRev: (hash: string) => void;
}) {
  const color = line.uncommitted ? null : authorColor(line.authorEmail, line.author);
  const style = color
    ? { background: color.tint, borderLeftColor: color.accent }
    : undefined;
  return (
    <div className="blame-line" role="row">
      <span className="blame-info" style={style}>
        {groupStart &&
          (line.uncommitted ? (
            <span className="blame-uncommitted">Uncommitted</span>
          ) : (
            <button
              type="button"
              className="blame-commit tooltip-host"
              data-tooltip={`${line.author} · ${shortDate(line.date)}\n${line.summary}`}
              onClick={() => onPickRev(line.hash)}
            >
              <span className="blame-hash" style={{ color: color?.accent }}>
                {line.shortHash}
              </span>
              <span className="blame-author">{line.author}</span>
              <span className="blame-date">{shortDate(line.date)}</span>
            </button>
          ))}
      </span>
      <span className="diff-gutter blame-gutter">{line.lineNo}</span>
      <span className="diff-code hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

/**
 * The file-history timeline: the commits that touched this file, newest first,
 * each dotted in its author's color. Clicking one shows that commit's change to
 * the file; the currently viewed revision is highlighted.
 */
function HistoryBody({
  history,
  rev,
  onPickRev,
}: {
  history: CommitLogEntry[] | null;
  rev: string;
  onPickRev: (hash: string) => void;
}) {
  if (history === null) return <p className="diff-empty">Loading…</p>;
  if (history.length === 0) return <p className="diff-empty">No history for this file.</p>;

  return (
    <div className="file-history" role="list">
      {history.map((commit) => {
        const color = authorColor(commit.authorEmail, commit.author);
        return (
          <button
            key={commit.hash}
            type="button"
            role="listitem"
            className={`file-history-row${commit.hash === rev ? ' active' : ''}`}
            onClick={() => onPickRev(commit.hash)}
          >
            <span className="file-history-dot" style={{ background: color.accent }} aria-hidden="true" />
            <span className="file-history-main">
              <span className="file-history-subject">{commit.subject}</span>
              <span className="file-history-meta">
                {commit.author} · {shortDate(commit.date)} · {commit.shortHash}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
