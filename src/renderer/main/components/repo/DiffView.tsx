import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type {
  BlameLine,
  CommitLogEntry,
  DiffSource,
  FileBlame,
  FileDiff,
  FileStatus,
  WorkingStatus,
  DateFormat,
} from '../../../../types/ipc';
import { highlightBuffer, highlightLine, languageForPath } from './syntax';
import { authorColor } from './authorColor';
import { useConfirm } from '../ConfirmBar';
import { CopyButton } from '../CopyButton';
import { formatDateOnly, useDateFormat } from '../../dateFormat';
import { ResizeHandle } from './ResizeHandle';
import { useResizableColumns } from './useResizableColumns';
import {
  ChevronDownIcon,
  CloseIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
} from '../../../../../assets/icons';

/**
 * The file a diff is opened for: its path, status, and where the diff is taken
 * from. `view`/`blame`/`history` optionally open the viewer directly in a given
 * configuration (e.g. a context menu launching straight into blame or history).
 */
export interface DiffTarget {
  source: DiffSource;
  path: string;
  status: FileStatus;
  /** Initial view mode; defaults to `diff`. */
  view?: ViewMode;
  /** Open with the blame annotations shown. */
  blame?: boolean;
  /** Open with the history sidebar shown. */
  history?: boolean;
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

/** The blame avatar's tooltip: the commit's hash, author, date, and title. */
function blameTooltip(line: BlameLine, dateFormat: DateFormat): string {
  return `${line.shortHash} · ${line.author} · ${formatDateOnly(line.date, dateFormat)}\n${line.summary}`;
}

/** What the body shows: the change to the file, or the file itself. */
export type ViewMode = 'diff' | 'file';

// The history sidebar's width, remembered across viewers for the session so a
// resized sidebar comes back the same when the next file is opened.
let historySidebarWidth = 280;

interface DiffViewProps {
  repoPath: string;
  target: DiffTarget;
  onClose: () => void;
  /** Push a fresh working-tree status up after a hunk is staged or discarded. */
  onWorkingStatusChange?: (status: WorkingStatus) => void;
  /** Leave the viewer and select this commit in the graph. */
  onSelectCommit?: (hash: string) => void;
}

/**
 * The center-column file viewer that swaps in over the commit list when a file
 * is selected. A header (path + close) sits over a secondary nav (a file/diff
 * mode switch, the viewed-revision label, blame/history toggles, and
 * older/newer revision steppers) over the body.
 *
 * Blame and history are independent overlays on whichever mode is showing:
 * history opens a sidebar listing the commits that touched the file, and blame
 * adds a per-line annotation column next to it, aligned with the body's lines.
 *
 * The viewer tracks a `rev` — the revision the file is shown at. It starts at
 * the commit the file was opened from (or the working tree for a staged/unstaged
 * change); picking a commit in the history sidebar, clicking a blame block, or
 * the revision steppers move it through the file's own history, and closing the
 * history sidebar returns to the original revision.
 */
export function DiffView({
  repoPath,
  target,
  onClose,
  onWorkingStatusChange,
  onSelectCommit,
}: DiffViewProps) {
  const { source, path, status } = target;
  const lang = useMemo(() => languageForPath(path), [path]);
  const requestConfirm = useConfirm();
  // Only the left width is used: it sizes the history sidebar.
  const { leftWidth: historyWidth, startResize } = useResizableColumns(historySidebarWidth, 320);
  useEffect(() => {
    historySidebarWidth = historyWidth;
  }, [historyWidth]);
  // The mode the user picked. The *effective* mode (`mode`, below) can differ:
  // when the viewed change is the whole file (every line added), diff and file
  // read the same, so the diff button is dropped and file is shown instead —
  // without touching the preference, so a later revision with a real diff
  // returns to what the user chose.
  const [preferredMode, setPreferredMode] = useState<ViewMode>(target.view ?? 'diff');
  const [showBlame, setShowBlame] = useState(target.blame ?? false);
  const [showHistory, setShowHistory] = useState(target.history ?? false);
  // Opening the history sidebar selects its first (newest) commit; when the
  // history is still loading, this defers that until it arrives.
  const [selectFirstOnLoad, setSelectFirstOnLoad] = useState(target.history ?? false);

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

  // The revision blame is taken at: the viewed commit, or for a range the range's
  // end (its diff's new side); '' blames the working tree.
  const blameRev = rev || (source.kind === 'range' ? source.to : '');

  // Opening a different file resets everything back to its initial revision.
  useEffect(() => {
    setPreferredMode(target.view ?? 'diff');
    setShowBlame(target.blame ?? false);
    setShowHistory(target.history ?? false);
    setSelectFirstOnLoad(target.history ?? false);
    setRev(source.kind === 'commit' ? source.hash : '');
    setHistory(null);
  }, [repoPath, path, source, target.view, target.blame, target.history]);

  // The whole file is the change (every content row added — e.g. the commit that
  // introduced it): the diff and file views would be identical.
  const wholeFile =
    diff !== null &&
    !diff.binary &&
    diff.lines.length > 0 &&
    diff.lines.every((line) => line.kind === 'add' || line.kind === 'hunk');
  const mode: ViewMode = wholeFile ? 'file' : preferredMode;

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

  // The diff is loaded in every mode: besides the diff body it decides whether
  // the change is the whole file (see `wholeFile`).
  useEffect(() => {
    if (diff !== null) return;
    let live = true;
    void window.api.repo.fileDiff(repoPath, viewSource, path).then((result) => {
      if (live) setDiff(result);
    });
    return () => {
      live = false;
    };
  }, [diff, repoPath, viewSource, path]);

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
    if (!showBlame || blame !== null) return;
    let live = true;
    void window.api.repo.fileBlame(repoPath, blameRev, path).then((result) => {
      if (live) setBlame(result);
    });
    return () => {
      live = false;
    };
  }, [showBlame, blame, repoPath, blameRev, path]);

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

  // Jump to a specific revision (from the history list, a blame block, or a
  // stepper). Browsing revisions shows the history sidebar so the viewed
  // revision is visible and closing it is the way back to the original.
  const pickRev = (hash: string) => {
    setRev(hash);
    setShowHistory(true);
  };

  // Opening the history sidebar selects its newest commit; closing it returns
  // the view to the revision the file was opened at (the working tree / staged
  // change, or the selected commit).
  const toggleHistory = () => {
    if (showHistory) {
      setRev(initialRev);
      setSelectFirstOnLoad(false);
    } else if (history && history.length > 0) {
      setRev(history[0].hash);
    } else {
      setSelectFirstOnLoad(true);
    }
    setShowHistory(!showHistory);
  };
  useEffect(() => {
    if (!selectFirstOnLoad || history === null) return;
    setSelectFirstOnLoad(false);
    if (history.length > 0) setRev(history[0].hash);
  }, [selectFirstOnLoad, history]);

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
            onClick={() => setPreferredMode('file')}
          >
            File
          </button>
          {!wholeFile && (
            <button
              type="button"
              className={mode === 'diff' ? 'active' : ''}
              aria-pressed={mode === 'diff'}
              onClick={() => setPreferredMode('diff')}
            >
              Diff
            </button>
          )}
        </div>
        <div className="diff-subnav-end">
          <div className="diff-viewswitch" role="group" aria-label="Panels">
            <button
              type="button"
              className={showBlame ? 'active' : ''}
              aria-pressed={showBlame}
              onClick={() => setShowBlame(!showBlame)}
            >
              Blame
            </button>
            <button
              type="button"
              className={showHistory ? 'active' : ''}
              aria-pressed={showHistory}
              onClick={toggleHistory}
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
              onClick={() => older !== null && pickRev(older)}
            >
              <ChevronDownIcon size={14} />
            </button>
            <button
              type="button"
              className="diff-step diff-step-next tooltip-host"
              data-tooltip="Newer revision"
              aria-label="Newer revision"
              disabled={newer === null}
              onClick={() => newer !== null && pickRev(newer)}
            >
              <ChevronDownIcon size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="diff-main">
        {showHistory && (
          <>
            <aside className="diff-history" aria-label="File history" style={{ width: historyWidth }}>
              <HistoryBody
                history={history}
                rev={rev}
                onPickRev={pickRev}
                onSelectCommit={onSelectCommit}
              />
            </aside>
            <ResizeHandle
              side="left"
              aria-label="Resize history"
              onPointerDown={startResize('left')}
            />
          </>
        )}
        <div className="diff-body">
          {mode === 'diff' ? (
            <DiffBody
              diff={diff}
              lang={lang}
              blame={showBlame ? blame : undefined}
              onPickRev={pickRev}
              onStageHunk={canStageHunks ? stageHunk : undefined}
              onDiscardHunk={canStageHunks ? discardHunk : undefined}
              onUnstageHunk={canUnstageHunks ? unstageHunk : undefined}
            />
          ) : (
            <FileBody
              content={content}
              lang={lang}
              blame={showBlame ? blame : undefined}
              onPickRev={pickRev}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The optional blame column of a body: `undefined` hides it, `null` shows it
 * while the blame loads, a value annotates each line. Handed down with the
 * callback a blame block jumps with.
 */
interface BlameColumn {
  blame: FileBlame | null | undefined;
  onPickRev: (hash: string) => void;
}

/** One row of the blame column, paired 1:1 with a row of the code pane. */
interface BlameRowSpec {
  /** The line's blame; null for a row without one (keeps a blank cell). */
  line: BlameLine | null;
  /** First row of a run of lines by the same commit: carries the annotation. */
  groupStart: boolean;
  /** Mirrors a hunk-header row, which is taller than a code row. */
  hunk: boolean;
}

/**
 * Keeps the blame column vertically in step with the code pane. The two are
 * separate elements — the code pane is the only scroller (both axes), so long
 * lines scroll under the sticky line numbers but never under the blame column —
 * and the column's content is translated to the pane's scrollTop on every
 * scroll. Wheeling over the column scrolls the pane, so it feels like one body.
 */
function useBlameSync() {
  const paneRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sync = useCallback(() => {
    const pane = paneRef.current;
    const scroll = scrollRef.current;
    if (pane && scroll) pane.style.transform = `translateY(${-scroll.scrollTop}px)`;
  }, []);
  const onWheel = useCallback((event: React.WheelEvent) => {
    scrollRef.current?.scrollBy({ top: event.deltaY });
  }, []);
  return { paneRef, scrollRef, sync, onWheel };
}

/**
 * The blame column beside a body's code pane: one cell per code row, in the
 * same order and at the same heights, so the annotations line up with the
 * lines they describe. Fixed-width and never horizontally scrolled.
 */
function BlamePane({
  rows,
  paneRef,
  sync,
  onWheel,
  onPickRev,
}: {
  rows: BlameRowSpec[];
  paneRef: React.RefObject<HTMLDivElement | null>;
  sync: () => void;
  onWheel: (event: React.WheelEvent) => void;
  onPickRev: (hash: string) => void;
}) {
  // Re-align whenever the column (re)renders — e.g. blame toggled on while the
  // pane is already scrolled, or the blame data arriving.
  useLayoutEffect(sync);
  return (
    <div className="blame-column" onWheel={onWheel} role="presentation">
      <div className="blame-column-inner" ref={paneRef}>
        {rows.map((row, index) => (
          <BlameCell
            key={index}
            line={row.line}
            groupStart={row.groupStart}
            hunk={row.hunk}
            onPickRev={onPickRev}
          />
        ))}
      </div>
    </div>
  );
}

/** The unified-diff rendering: two line-number gutters and a marked code column.
 * Each line is highlighted on its own — add/delete/context lines don't form a
 * contiguous program, so a whole-hunk highlight would be misleading. With blame
 * on, a separate column beside the pane annotates each row that exists on the
 * diff's new side (context/add lines); deleted lines and hunk headers get a
 * blank cell. */
function DiffBody({
  diff,
  lang,
  blame,
  onPickRev,
  onStageHunk,
  onDiscardHunk,
  onUnstageHunk,
}: BlameColumn & {
  diff: FileDiff | null;
  lang: string | null;
  /** Stage the hunk at this index (unstaged view); paired with onDiscardHunk. */
  onStageHunk?: (hunkIndex: number) => void;
  onDiscardHunk?: (hunkIndex: number) => void;
  /** Unstage the hunk at this index (staged view). */
  onUnstageHunk?: (hunkIndex: number) => void;
}) {
  const { paneRef, scrollRef, sync, onWheel } = useBlameSync();

  // The blame column's rows, one per diff row. The annotation shows once per
  // run of rows by the same commit; a row without a blame line (delete rows,
  // hunk headers) breaks the run.
  const blameRows = useMemo<BlameRowSpec[]>(() => {
    if (blame === undefined || diff === null) return [];
    let prevHash: string | null = null;
    return diff.lines.map((line) => {
      const hunk = line.kind === 'hunk';
      const blameLine =
        !hunk && line.newLine !== null ? blame?.lines[line.newLine - 1] ?? null : null;
      const groupStart = blameLine !== null && blameLine.hash !== prevHash;
      prevHash = blameLine?.hash ?? null;
      return { line: blameLine, groupStart, hunk };
    });
  }, [blame, diff]);

  if (diff === null) return <p className="diff-empty">Loading…</p>;
  if (diff.binary) return <p className="diff-empty">Binary file — no diff to show.</p>;
  if (diff.lines.length === 0) return <p className="diff-empty">No changes.</p>;

  const hunkActions = (onStageHunk && onDiscardHunk) || onUnstageHunk;
  // Hunks are numbered in diff order, matching how the main process re-derives
  // them for `stageHunk`/`discardHunk`; count headers seen so far as we render.
  let hunkIndex = -1;
  return (
    <>
      {blame !== undefined && (
        <BlamePane
          rows={blameRows}
          paneRef={paneRef}
          sync={sync}
          onWheel={onWheel}
          onPickRev={onPickRev}
        />
      )}
      <div className="diff-scroll" ref={scrollRef} onScroll={sync}>
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
      </div>
    </>
  );
}

/** The full-file rendering: a single line-number gutter and the content column.
 * The whole buffer is highlighted at once so multi-line constructs stay intact,
 * then split back into per-line markup aligned with the content lines. With
 * blame on, a separate column beside the pane carries blame line N next to
 * content line N (both are the file at the same rev). */
function FileBody({
  content,
  lang,
  blame,
  onPickRev,
}: BlameColumn & { content: string[] | null; lang: string | null }) {
  const { paneRef, scrollRef, sync, onWheel } = useBlameSync();
  const html = useMemo(
    () => (content ? highlightBuffer(content.join('\n'), lang) : []),
    [content, lang],
  );
  const blameRows = useMemo<BlameRowSpec[]>(() => {
    if (blame === undefined || content === null) return [];
    return content.map((_, index) => {
      const line = blame?.lines[index] ?? null;
      const groupStart =
        line !== null && (index === 0 || blame?.lines[index - 1]?.hash !== line.hash);
      return { line, groupStart, hunk: false };
    });
  }, [blame, content]);

  if (content === null) return <p className="diff-empty">Loading…</p>;
  if (content.length === 0) return <p className="diff-empty">Empty or binary file.</p>;

  return (
    <>
      {blame !== undefined && (
        <BlamePane
          rows={blameRows}
          paneRef={paneRef}
          sync={sync}
          onWheel={onWheel}
          onPickRev={onPickRev}
        />
      )}
      <div className="diff-scroll" ref={scrollRef} onScroll={sync}>
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
      </div>
    </>
  );
}

/**
 * One cell of the blame column: the commit that last touched the matching code
 * row. Consecutive lines by the same commit form a run — the annotation (author
 * avatar, commit title, and date) shows only on the run's first line, and each
 * run is tinted and bordered in the author's color; the hash and author live in
 * the avatar's tooltip (see `blameTooltip`). Clicking a run jumps to that
 * commit's change to the file. `line` is null for rows with no blame (a deleted
 * diff line, a hunk header, or while the blame is still loading), which keeps a
 * blank cell for alignment; `hunk` sizes the cell to a hunk-header row.
 */
function BlameCell({
  line,
  groupStart,
  hunk,
  onPickRev,
}: {
  line: BlameLine | null;
  groupStart: boolean;
  hunk: boolean;
  onPickRev: (hash: string) => void;
}) {
  const dateFormat = useDateFormat();
  const color = line && !line.uncommitted ? authorColor(line.authorEmail, line.author) : null;
  const style = color ? { background: color.tint, borderLeftColor: color.accent } : undefined;
  return (
    <div className={`blame-info${hunk ? ' blame-info-hunk' : ''}`} style={style}>
      {line &&
        groupStart &&
        (line.uncommitted ? (
          <span className="blame-uncommitted">Uncommitted</span>
        ) : (
          <button type="button" className="blame-commit" onClick={() => onPickRev(line.hash)}>
            <img
              className="blame-avatar tooltip-host"
              data-tooltip={blameTooltip(line, dateFormat)}
              src={line.authorAvatarUrl}
              alt={line.author}
              width={16}
              height={16}
              loading="lazy"
              draggable={false}
            />
            <span className="blame-summary">{line.summary}</span>
            <span className="blame-date">{formatDateOnly(line.date, dateFormat)}</span>
          </button>
        ))}
    </div>
  );
}

/**
 * The history sidebar's timeline: the commits that touched this file, newest
 * first. Each row is the author's avatar (edged in their blame color), the
 * commit title over its date + author, and the short hash. Clicking a row shows
 * that commit's version of the file in the body (the viewed revision is
 * highlighted); clicking the hash leaves the viewer for that commit in the graph.
 */
function HistoryBody({
  history,
  rev,
  onPickRev,
  onSelectCommit,
}: {
  history: CommitLogEntry[] | null;
  rev: string;
  onPickRev: (hash: string) => void;
  onSelectCommit?: (hash: string) => void;
}) {
  const dateFormat = useDateFormat();
  if (history === null) return <p className="diff-empty">Loading…</p>;
  if (history.length === 0) return <p className="diff-empty">No history for this file.</p>;

  return (
    <div className="file-history" role="group">
      {history.map((commit) => {
        const color = authorColor(commit.authorEmail, commit.author);
        const pick = () => onPickRev(commit.hash);
        // A div rather than a button: the row hosts the hash's copy button, and
        // buttons can't nest. Enter/Space select it for keyboard users.
        return (
          <div
            key={commit.hash}
            role="button"
            tabIndex={0}
            className={`file-history-row${commit.hash === rev ? ' active' : ''}`}
            onClick={pick}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                pick();
              }
            }}
          >
            <img
              className="file-history-avatar"
              src={commit.authorAvatarUrl}
              alt=""
              loading="lazy"
              draggable={false}
              style={{ borderColor: color.accent }}
            />
            <span className="file-history-main">
              <span
                className="file-history-subject tooltip-host"
                data-tooltip={commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject}
              >
                {commit.subject}
              </span>
              <span className="file-history-meta">
                {formatDateOnly(commit.date, dateFormat)} · {commit.author}
              </span>
            </span>
            {/* The hash is its own hover target: it jumps to the commit in the
                graph, and reveals its copy button only when hovered itself. */}
            <span className="file-history-hash copy-host">
              <button
                type="button"
                className="file-history-hash-link tooltip-host"
                data-tooltip="Jump to commit in graph"
                disabled={!onSelectCommit}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectCommit?.(commit.hash);
                }}
              >
                {commit.shortHash}
              </button>
              <CopyButton text={commit.hash} what="commit hash" size={12} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
