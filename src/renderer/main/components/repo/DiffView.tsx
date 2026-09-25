import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type {
  BlameLine,
  CommitLogEntry,
  DiffLineRef,
  DiffOptions,
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
  HunkViewIcon,
  InlineViewIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  SplitViewIcon,
  WhitespaceIcon,
  WrapIcon,
  type IconProps,
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

/**
 * How diff mode lays a change out: `hunks` shows just the changed regions with
 * a little context, `inline` the whole file with the changes woven in, and
 * `split` the whole file's old and new versions side by side.
 */
type DiffLayout = 'hunks' | 'inline' | 'split';

/** The viewer's display preferences, remembered across files and restarts. */
interface DiffPrefs {
  layout: DiffLayout;
  /** Hide whitespace-only changes (display only — staging is off meanwhile). */
  ignoreWhitespace: boolean;
  /** Soft-wrap long lines instead of scrolling horizontally. */
  wrap: boolean;
}

const DIFF_PREFS_KEY = 'gitleviathan.diffPrefs';
const DEFAULT_DIFF_PREFS: DiffPrefs = { layout: 'hunks', ignoreWhitespace: false, wrap: false };

/** The layout switch's buttons, in order. */
const DIFF_LAYOUTS: { layout: DiffLayout; label: string; Icon: (props: IconProps) => React.JSX.Element }[] = [
  { layout: 'hunks', label: 'Hunk view', Icon: HunkViewIcon },
  { layout: 'inline', label: 'Inline view', Icon: InlineViewIcon },
  { layout: 'split', label: 'Split view', Icon: SplitViewIcon },
];

function loadDiffPrefs(): DiffPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(DIFF_PREFS_KEY) ?? '{}') as Partial<DiffPrefs>;
    return {
      layout:
        raw.layout === 'inline' || raw.layout === 'split' ? raw.layout : DEFAULT_DIFF_PREFS.layout,
      ignoreWhitespace: raw.ignoreWhitespace === true,
      wrap: raw.wrap === true,
    };
  } catch {
    return DEFAULT_DIFF_PREFS;
  }
}

function saveDiffPrefs(prefs: DiffPrefs) {
  try {
    localStorage.setItem(DIFF_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable — the preference just won't persist.
  }
}

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
  /** Surface a failure, e.g. git rejecting a line-level stage/discard patch. */
  onError?: (title: string, message: string) => void;
  /** Swap the viewer to another target, e.g. the same file's other side. */
  onRetarget?: (target: DiffTarget) => void;
}

/**
 * The center-column file viewer that swaps in over the commit list when a file
 * is selected. A header (path + close) sits over a secondary nav (a file/diff
 * mode switch, the viewed-revision label, blame/history toggles, and
 * previous/next hunk steppers) over the body.
 *
 * Blame and history are independent overlays on whichever mode is showing:
 * history opens a sidebar listing the commits that touched the file, and blame
 * adds a per-line annotation column next to it, aligned with the body's lines.
 *
 * The viewer tracks a `rev` — the revision the file is shown at. It starts at
 * the commit the file was opened from (or the working tree for a staged/unstaged
 * change); picking a commit in the history sidebar or clicking a blame block
 * moves it through the file's own history, and closing the history sidebar
 * returns to the original revision.
 */
export function DiffView({
  repoPath,
  target,
  onClose,
  onWorkingStatusChange,
  onSelectCommit,
  onError,
  onRetarget,
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
  const [prefs, setPrefs] = useState<DiffPrefs>(loadDiffPrefs);
  const updatePrefs = (patch: Partial<DiffPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveDiffPrefs(next);
      return next;
    });
  };
  // How the diff is read: the whole file for the inline and split layouts, and optionally
  // without whitespace-only changes. Hunk/line staging passes the same options
  // so its indices match what's on screen.
  const diffOptions = useMemo<DiffOptions>(
    () => ({
      context: prefs.layout === 'hunks' ? 'hunks' : 'full',
      ignoreWhitespace: prefs.ignoreWhitespace,
    }),
    [prefs.layout, prefs.ignoreWhitespace],
  );
  const [showHistory, setShowHistory] = useState(target.history ?? false);
  // Opening the history sidebar selects its first (newest) commit; when the
  // history is still loading, this defers that until it arrives.
  const [selectFirstOnLoad, setSelectFirstOnLoad] = useState(target.history ?? false);

  // The revision the file is viewed at: '' means the working tree / the original
  // source (a staged/unstaged/range change), a hash means that commit. Opening
  // from a commit's file starts there so the history list and blame have an anchor.
  const initialRev = source.kind === 'commit' ? source.hash : '';
  const [rev, setRev] = useState(initialRev);

  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [content, setContent] = useState<string[] | null>(null);
  const [blame, setBlame] = useState<FileBlame | null>(null);
  // The file's history (commits that touched it), for the timeline + revision
  // label. Fetched once per file; null while loading.
  const [history, setHistory] = useState<CommitLogEntry[] | null>(null);
  // Hunk stepping: the diff body registers its jump function here and reports
  // whether there's a hunk above/below the current scroll position.
  const hunkNav = useRef<((dir: -1 | 1) => void) | null>(null);
  const [hunkNavState, setHunkNavState] = useState<HunkNavState>(NO_HUNK_NAV);

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
  // The row-aligned blame column can't sit beside split view's two panes, nor
  // beside wrapped rows (they vary in height).
  const split = mode === 'diff' && prefs.layout === 'split';
  const blameOn = showBlame && !split;
  const wrapOn = prefs.wrap && !blameOn;

  // The viewed revision (or the file) changed: rev-dependent views are stale.
  useEffect(() => {
    setDiff(null);
    setContent(null);
    setBlame(null);
  }, [repoPath, path, viewSource]);

  // A different diff read (layout context / whitespace) needs a fresh diff only.
  useEffect(() => {
    setDiff(null);
  }, [diffOptions]);

  // Load the file's history once per file — it powers both the timeline and the
  // viewed-revision label, so it's fetched eagerly rather than only in history mode.
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
    void window.api.repo.fileDiff(repoPath, viewSource, path, diffOptions).then((result) => {
      if (live) setDiff(result);
    });
    return () => {
      live = false;
    };
  }, [diff, repoPath, viewSource, path, diffOptions]);

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
    if (!blameOn || blame !== null) return;
    let live = true;
    void window.api.repo.fileBlame(repoPath, blameRev, path).then((result) => {
      if (live) setBlame(result);
    });
    return () => {
      live = false;
    };
  }, [blameOn, blame, repoPath, blameRev, path]);

  // Hunk-level actions only apply when the *original* working-tree change is in
  // view (rev === '' and a staged/unstaged source) — not a historical revision.
  const atOriginal = rev === '';
  // A whitespace-ignoring diff can't be staged faithfully (its context lines
  // needn't match the file), so hunk/line actions are off while it's shown.
  const canStage = atOriginal && !prefs.ignoreWhitespace;
  const canStageHunks = canStage && source.kind === 'unstaged';
  const canUnstageHunks = canStage && source.kind === 'staged';
  // Whole-hunk pills only in the hunk layout: inline and split read the whole
  // file as a single hunk, where they'd act on every change at once.
  const hunkButtons = prefs.layout === 'hunks';
  // After a hunk/line action, reload this side's diff. When that emptied it
  // (the last change was staged, unstaged or discarded), follow the file to the
  // other side if it still has changes there — as staging a whole file does —
  // and only close the viewer when the file has no changes left at all.
  const afterHunk = useCallback(
    async (nextStatus: WorkingStatus) => {
      onWorkingStatusChange?.(nextStatus);
      const fresh = await window.api.repo.fileDiff(repoPath, source, path, diffOptions);
      if (fresh.lines.length > 0) {
        setDiff(fresh);
        return;
      }
      const otherKind = source.kind === 'unstaged' ? 'staged' : 'unstaged';
      const other = nextStatus[otherKind].find((file) => file.path === path);
      if (other && onRetarget) {
        onRetarget({ source: { kind: otherKind }, path, status: other.status });
      } else {
        onClose();
      }
    },
    [onWorkingStatusChange, repoPath, source, path, diffOptions, onClose, onRetarget],
  );
  const stageHunk = useCallback(
    async (hunkIndex: number) => {
      await afterHunk(await window.api.repo.stageHunk(repoPath, path, hunkIndex, diffOptions));
    },
    [afterHunk, repoPath, path, diffOptions],
  );
  const unstageHunk = useCallback(
    async (hunkIndex: number) => {
      await afterHunk(await window.api.repo.unstageHunk(repoPath, path, hunkIndex, diffOptions));
    },
    [afterHunk, repoPath, path, diffOptions],
  );
  // Line-level stage/unstage/discard. Guarded so a quick second click can't
  // fire against the pre-refresh diff, whose row indices the first action just
  // shifted. A rejected patch still refreshes (the status is returned either
  // way) and surfaces git's reason.
  const [lineBusy, setLineBusy] = useState(false);
  const runLines = useCallback(
    async (action: LineAction, refs: DiffLineRef[]) => {
      if (lineBusy || refs.length === 0) return;
      setLineBusy(true);
      try {
        const result =
          action === 'stage'
            ? await window.api.repo.stageLines(repoPath, path, refs, diffOptions)
            : action === 'unstage'
              ? await window.api.repo.unstageLines(repoPath, path, refs, diffOptions)
              : await window.api.repo.discardLines(repoPath, path, refs, diffOptions);
        if (result.error) onError?.(LINE_ACTION_FAILED[action], result.error);
        await afterHunk(result.status);
      } finally {
        setLineBusy(false);
      }
    },
    [lineBusy, repoPath, path, diffOptions, onError, afterHunk],
  );
  // Discarding is irreversible, so it's confirmed first; stage/unstage run as-is.
  const requestLines = useCallback(
    (action: LineAction, refs: DiffLineRef[]) => {
      if (action !== 'discard') {
        void runLines(action, refs);
        return;
      }
      const what = refs.length === 1 ? 'this line' : `these ${refs.length} lines`;
      requestConfirm({
        message: `Discard ${what}? This cannot be undone.`,
        actions: [
          {
            label: refs.length === 1 ? 'Discard line' : 'Discard lines',
            busyLabel: 'Discarding…',
            tone: 'danger',
            onClick: () => runLines('discard', refs),
          },
        ],
      });
    },
    [runLines, requestConfirm],
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
              await afterHunk(
                await window.api.repo.discardHunk(repoPath, path, hunkIndex, diffOptions),
              );
            },
          },
        ],
      });
    },
    [requestConfirm, afterHunk, repoPath, path, diffOptions],
  );

  // Jump to a specific revision (from the history list or a blame block).
  // Browsing revisions shows the history sidebar so the viewed revision is
  // visible and closing it is the way back to the original.
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

  // A short label for the viewed revision, shown before the mode switch.
  const revLabel =
    rev === ''
      ? source.kind === 'range'
        ? 'Range'
        : 'Working tree'
      : history?.find((commit) => commit.hash === rev)?.shortHash ?? rev.slice(0, 7);

  // The hunk steppers only apply to the diff; in the hunk layout they stop at
  // each hunk, in the whole-file layouts (one hunk) at each run of changes.
  const hunkStops = prefs.layout === 'hunks' ? 'hunk' : 'change';
  const hunkWord = hunkStops === 'hunk' ? 'hunk' : 'change';
  const canPrevHunk = mode === 'diff' && hunkNavState.prev;
  const canNextHunk = mode === 'diff' && hunkNavState.next;

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
              className={`tooltip-host${blameOn ? ' active' : ''}`}
              data-tooltip={split ? 'Blame isn’t available in split view' : 'Show who last changed each line'}
              aria-pressed={blameOn}
              disabled={split}
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
              data-tooltip={`Previous ${hunkWord}`}
              aria-label={`Previous ${hunkWord}`}
              disabled={!canPrevHunk}
              onClick={() => hunkNav.current?.(-1)}
            >
              <ChevronDownIcon size={14} />
            </button>
            <button
              type="button"
              className="diff-step diff-step-next tooltip-host"
              data-tooltip={`Next ${hunkWord}`}
              aria-label={`Next ${hunkWord}`}
              disabled={!canNextHunk}
              onClick={() => hunkNav.current?.(1)}
            >
              <ChevronDownIcon size={14} />
            </button>
          </div>
          {mode === 'diff' && (
            <div className="diff-viewswitch" role="group" aria-label="Diff layout">
              {DIFF_LAYOUTS.map(({ layout, label, Icon }) => (
                <button
                  key={layout}
                  type="button"
                  className={`is-icon tooltip-host${prefs.layout === layout ? ' active' : ''}`}
                  data-tooltip={label}
                  aria-label={label}
                  aria-pressed={prefs.layout === layout}
                  onClick={() => updatePrefs({ layout })}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          )}
          <div className="diff-viewswitch" role="group" aria-label="Display options">
            {mode === 'diff' && (
              <button
                type="button"
                className={`is-icon tooltip-host${prefs.ignoreWhitespace ? ' active' : ''}`}
                data-tooltip={
                  prefs.ignoreWhitespace
                    ? 'Ignore leading/trailing whitespace (staging is off while this is on)'
                    : 'Ignore leading/trailing whitespace'
                }
                aria-label="Ignore leading/trailing whitespace"
                aria-pressed={prefs.ignoreWhitespace}
                onClick={() => updatePrefs({ ignoreWhitespace: !prefs.ignoreWhitespace })}
              >
                <WhitespaceIcon size={16} />
              </button>
            )}
            <button
              type="button"
              className={`is-icon tooltip-host${wrapOn ? ' active' : ''}`}
              data-tooltip={blameOn ? 'Word wrap (unavailable while blame is shown)' : 'Word wrap'}
              aria-label="Word wrap"
              aria-pressed={wrapOn}
              disabled={blameOn}
              onClick={() => updatePrefs({ wrap: !prefs.wrap })}
            >
              <WrapIcon size={16} />
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
              layout={split ? 'split' : 'unified'}
              wrap={wrapOn}
              blame={blameOn ? blame : undefined}
              onPickRev={pickRev}
              onStageHunk={hunkButtons && canStageHunks ? stageHunk : undefined}
              onDiscardHunk={hunkButtons && canStageHunks ? discardHunk : undefined}
              onUnstageHunk={hunkButtons && canUnstageHunks ? unstageHunk : undefined}
              linesMode={canStageHunks ? 'unstaged' : canUnstageHunks ? 'staged' : null}
              onLines={requestLines}
              lineBusy={lineBusy}
              navStops={hunkStops}
              navRef={hunkNav}
              onNavState={setHunkNavState}
            />
          ) : (
            <FileBody
              content={content}
              lang={lang}
              wrap={wrapOn}
              blame={blameOn ? blame : undefined}
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

/** A line-level action on picked diff rows. */
type LineAction = 'stage' | 'unstage' | 'discard';

/** Toast title per line action when git rejects the patch. */
const LINE_ACTION_FAILED: Record<LineAction, string> = {
  stage: 'Couldn’t stage lines',
  unstage: 'Couldn’t unstage lines',
  discard: 'Couldn’t discard lines',
};

/** A diff row's address for line staging, plus its paired edit's row index. */
interface RowRef {
  hunk: number;
  row: number;
  /** Diff row index of the other half of an edited line, or null. */
  partner: number | null;
}

/** Whether the diff has a hunk stop above / below its current scroll position. */
interface HunkNavState {
  prev: boolean;
  next: boolean;
}

const NO_HUNK_NAV: HunkNavState = { prev: false, next: false };

/** Rows of context shown above a run of changes the steppers jump to. */
const CHANGE_STOP_CONTEXT = 3;

/** A row the diff body draws (see DiffBody's `displayRows`). */
type DisplayRow =
  | { kind: 'hunk'; index: number; hunk: number }
  | { kind: 'line'; index: number }
  | { kind: 'pair'; left: number | null; right: number | null };

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

/** The diff rendering. Unified: two line-number gutters and a marked code
 * column per row. Split: each row pairs an old-side cell with a new-side cell
 * (a run of removed lines beside the run of added lines that replaced it), each
 * with its own gutter. Each line is highlighted on its own — add/delete/context
 * lines don't form a contiguous program, so a whole-hunk highlight would be
 * misleading. With blame on (unified only), a separate column beside the pane
 * annotates each row that exists on the diff's new side (context/add lines);
 * deleted lines and hunk headers get a blank cell. */
function DiffBody({
  diff,
  lang,
  layout = 'unified',
  wrap = false,
  blame,
  onPickRev,
  onStageHunk,
  onDiscardHunk,
  onUnstageHunk,
  linesMode = null,
  onLines,
  lineBusy = false,
  navStops = 'hunk',
  navRef,
  onNavState,
}: BlameColumn & {
  diff: FileDiff | null;
  lang: string | null;
  /** One column of rows, or old and new side by side (always wrapped). */
  layout?: 'unified' | 'split';
  /** Soft-wrap long lines. */
  wrap?: boolean;
  /** Stage the hunk at this index (unstaged view); paired with onDiscardHunk. */
  onStageHunk?: (hunkIndex: number) => void;
  onDiscardHunk?: (hunkIndex: number) => void;
  /** Unstage the hunk at this index (staged view). */
  onUnstageHunk?: (hunkIndex: number) => void;
  /**
   * Which line-level actions the diff offers: stage + discard for the unstaged
   * view, unstage for the staged view, none (null) for anything else.
   */
  linesMode?: 'unstaged' | 'staged' | null;
  /** Run a line-level action on the given rows. */
  onLines?: (action: LineAction, refs: DiffLineRef[]) => void;
  /** A line action is in flight; the line buttons are disabled meanwhile. */
  lineBusy?: boolean;
  /** Where the hunk steppers stop: each `@@` header, or each run of changes. */
  navStops?: 'hunk' | 'change';
  /** Receives the function that scrolls to the previous (-1) / next (1) stop. */
  navRef?: React.RefObject<((dir: -1 | 1) => void) | null>;
  /** Told whether a stop lies above / below the current scroll position. */
  onNavState?: (state: HunkNavState) => void;
}) {
  const { paneRef, scrollRef, sync, onWheel } = useBlameSync();
  // Unwrapped split view renders old and new as two panes, each scrolling
  // sideways on its own; their vertical scroll is mirrored so rows stay level.
  const oldPaneRef = useRef<HTMLDivElement>(null);
  const newPaneRef = useRef<HTMLDivElement>(null);
  const mirrorScroll = (from: HTMLDivElement, to: HTMLDivElement | null) => {
    if (to && to.scrollTop !== from.scrollTop) to.scrollTop = from.scrollTop;
  };

  // Each diff row's address for line staging (null for hunk headers), plus its
  // "partner": in a block of removed lines directly followed by added lines,
  // the i-th removed line pairs with the i-th added one — the before/after of
  // one edited line — so a single click can stage both halves together.
  const rowRefs = useMemo(() => {
    const refs: (RowRef | null)[] = [];
    if (diff === null) return refs;
    let hunk = -1;
    let row = -1;
    let deletes: number[] = [];
    let adds: number[] = [];
    const pairUp = () => {
      for (let i = 0; i < Math.min(deletes.length, adds.length); i++) {
        (refs[deletes[i]] as RowRef).partner = adds[i];
        (refs[adds[i]] as RowRef).partner = deletes[i];
      }
      deletes = [];
      adds = [];
    };
    diff.lines.forEach((line, index) => {
      if (line.kind === 'hunk') {
        pairUp();
        hunk += 1;
        row = -1;
        refs[index] = null;
        return;
      }
      row += 1;
      refs[index] = { hunk, row, partner: null };
      if (line.kind === 'delete') {
        if (adds.length > 0) pairUp();
        deletes.push(index);
      } else if (line.kind === 'add') {
        adds.push(index);
      } else {
        pairUp();
      }
    });
    pairUp();
    return refs;
  }, [diff]);

  // The rows to draw. Unified: one per diff line. Split: hunk headers, plus
  // pairs — a context line on both sides, and each run of removed lines zipped
  // with the run of added lines after it (the shorter side padded with blanks).
  const displayRows = useMemo(() => {
    const rows: DisplayRow[] = [];
    if (diff === null) return rows;
    let hunk = -1;
    let deletes: number[] = [];
    let adds: number[] = [];
    const flush = () => {
      for (let i = 0; i < Math.max(deletes.length, adds.length); i++) {
        rows.push({ kind: 'pair', left: deletes[i] ?? null, right: adds[i] ?? null });
      }
      deletes = [];
      adds = [];
    };
    diff.lines.forEach((line, index) => {
      if (line.kind === 'hunk') {
        flush();
        hunk += 1;
        rows.push({ kind: 'hunk', index, hunk });
      } else if (layout === 'unified') {
        rows.push({ kind: 'line', index });
      } else if (line.kind === 'delete') {
        if (adds.length > 0) flush();
        deletes.push(index);
      } else if (line.kind === 'add') {
        adds.push(index);
      } else {
        flush();
        rows.push({ kind: 'pair', left: index, right: index });
      }
    });
    flush();
    return rows;
  }, [diff, layout]);

  // The display rows the hunk steppers land on: each hunk header, or — in the
  // whole-file layouts, where the diff is one hunk — a few rows of context above
  // the start of each run of changed rows.
  const navTargets = useMemo(() => {
    if (diff === null) return [];
    if (navStops === 'hunk') {
      return displayRows.flatMap((row, i) => (row.kind === 'hunk' ? [i] : []));
    }
    const changedIndex = (index: number | null) =>
      index !== null && diff.lines[index].kind !== 'context';
    const isChange = (row: DisplayRow) =>
      row.kind === 'line'
        ? changedIndex(row.index)
        : row.kind === 'pair' && (changedIndex(row.left) || changedIndex(row.right));
    const targets: number[] = [];
    displayRows.forEach((row, i) => {
      if (isChange(row) && (i === 0 || !isChange(displayRows[i - 1]))) {
        targets.push(Math.max(0, i - CHANGE_STOP_CONTEXT));
      }
    });
    return targets;
  }, [diff, displayRows, navStops]);

  // The element the rows scroll in: the pane, or the new side of an unwrapped
  // split (the old side mirrors it). Its `.diff-lines` children are the display
  // rows, one element each.
  const navScroller = () => (layout === 'split' && !wrap ? newPaneRef.current : scrollRef.current);
  // The scrollTop that brings each stop to the top, clamped to what the pane
  // can actually scroll to (stops near the end all land at the bottom).
  const navOffsets = (scroller: HTMLElement): number[] => {
    const rows = scroller.querySelector(':scope > .diff-lines')?.children;
    if (!rows) return [];
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const max = scroller.scrollHeight - scroller.clientHeight;
    return navTargets.flatMap((i) => {
      const row = rows[i];
      if (!row) return [];
      return [Math.min(max, Math.max(0, Math.round(row.getBoundingClientRect().top - base)))];
    });
  };
  const navState = useRef<HunkNavState>(NO_HUNK_NAV);
  const reportNav = () => {
    const scroller = navScroller();
    const offsets = scroller ? navOffsets(scroller) : [];
    const top = scroller?.scrollTop ?? 0;
    const next = {
      prev: offsets.some((offset) => offset < top - 1),
      next: offsets.some((offset) => offset > top + 1),
    };
    if (next.prev === navState.current.prev && next.next === navState.current.next) return;
    navState.current = next;
    onNavState?.(next);
  };
  const jumpToStop = (dir: -1 | 1) => {
    const scroller = navScroller();
    if (!scroller) return;
    const top = scroller.scrollTop;
    const offsets = navOffsets(scroller);
    const target =
      dir === 1
        ? offsets.find((offset) => offset > top + 1)
        : offsets.findLast((offset) => offset < top - 1);
    if (target !== undefined) scroller.scrollTop = target;
  };
  // Re-publish the jump function and re-check the stops after every render (a
  // new diff, layout, or wrap moves them); scrolling re-checks too.
  useLayoutEffect(() => {
    if (navRef) navRef.current = jumpToStop;
    reportNav();
  });
  useEffect(
    () => () => {
      if (navRef) navRef.current = null;
      onNavState?.(NO_HUNK_NAV);
    },
    [navRef, onNavState],
  );

  // Multi-line selection (diff row indices), made by clicking the line-number
  // gutters: plain click selects one row (or clears a lone selection), ⌘/Ctrl
  // toggles, Shift extends from the anchor. Any new diff invalidates it.
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<number>>(() => new Set());
  const [anchorRow, setAnchorRow] = useState<number | null>(null);
  // Rows the hovered line button would act on, outlined so a paired edit or a
  // selection shows what one click covers.
  const [targetRows, setTargetRows] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => {
    setSelectedRows(new Set());
    setAnchorRow(null);
    setTargetRows(new Set());
  }, [diff, linesMode]);

  // Escape clears a selection.
  useEffect(() => {
    if (selectedRows.size === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setSelectedRows(new Set());
      setAnchorRow(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedRows]);

  const isChanged = (index: number) => {
    const kind = diff?.lines[index]?.kind;
    return kind === 'add' || kind === 'delete';
  };

  const selectRow = (index: number, event: React.MouseEvent) => {
    if (event.shiftKey && anchorRow !== null) {
      const [lo, hi] = anchorRow <= index ? [anchorRow, index] : [index, anchorRow];
      const next = new Set<number>();
      for (let i = lo; i <= hi; i++) if (isChanged(i)) next.add(i);
      setSelectedRows(next);
      return;
    }
    setAnchorRow(index);
    if (event.metaKey || event.ctrlKey) {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
      return;
    }
    setSelectedRows((prev) =>
      prev.size === 1 && prev.has(index) ? new Set() : new Set([index]),
    );
  };

  // The rows a line button on `index` acts on: the whole selection when that
  // row is part of it, otherwise the row plus its paired edit (if any).
  const targetsFor = (index: number): number[] => {
    if (selectedRows.has(index)) return [...selectedRows].sort((a, b) => a - b);
    const partner = rowRefs[index]?.partner;
    return partner == null ? [index] : [index, partner].sort((a, b) => a - b);
  };

  const toRefs = (indices: number[]): DiffLineRef[] =>
    indices.flatMap((i) => {
      const ref = rowRefs[i];
      return ref ? [{ hunk: ref.hunk, row: ref.row }] : [];
    });

  const lineLabel = (action: LineAction, index: number) => {
    const verb = action === 'stage' ? 'Stage' : action === 'unstage' ? 'Unstage' : 'Discard';
    if (selectedRows.has(index) && selectedRows.size > 1) {
      return `${verb} ${selectedRows.size} selected lines`;
    }
    if (rowRefs[index]?.partner != null) return `${verb} this change (removed + added line)`;
    return `${verb} this line`;
  };

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
  const lineButtons = linesMode !== null && onLines !== undefined;
  const primaryAction: LineAction = linesMode === 'staged' ? 'unstage' : 'stage';
  const lineButton = (action: LineAction, index: number) => (
    <button
      type="button"
      className={`diff-line-stage is-${action} tooltip-host`}
      data-tooltip={lineLabel(action, index)}
      aria-label={lineLabel(action, index)}
      disabled={lineBusy}
      onClick={(event) => {
        event.stopPropagation();
        onLines?.(action, toRefs(targetsFor(index)));
      }}
      onMouseEnter={() => setTargetRows(new Set(targetsFor(index)))}
      onMouseLeave={() => setTargetRows(new Set())}
    >
      {action === 'stage' ? (
        <PlusIcon size={10} />
      ) : action === 'unstage' ? (
        <MinusIcon size={10} />
      ) : selectedRows.has(index) && selectedRows.size > 1 ? (
        `Discard ${selectedRows.size} lines`
      ) : (
        'Discard line'
      )}
    </button>
  );
  const selectedRefs = toRefs([...selectedRows].sort((a, b) => a - b));

  // A hunk's `@@` separator row, with its stage/discard/unstage pills (unless
  // `withActions` is false — the old pane of an unwrapped split). Hunks are
  // numbered in diff order, matching how the main process re-derives them.
  const hunkRow = (index: number, hunk: number, withActions = true, key?: number) => {
    const text = diff.lines[index].text;
    const rangeEnd = text.indexOf('@@', 2);
    const hunkText = rangeEnd === -1 ? text : text.slice(0, rangeEnd + 2);
    return (
      <div key={key ?? index} className="diff-line diff-line-hunk" role="row">
        <span className="diff-hunk-text">{hunkText}</span>
        {hunkActions && withActions && (
          <span className="diff-hunk-actions">
            {onUnstageHunk ? (
              <button
                type="button"
                className="pill-btn pill-btn-red diff-hunk-btn tooltip-host"
                data-tooltip="Unstage this hunk"
                onClick={() => onUnstageHunk(hunk)}
              >
                Unstage Hunk
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="pill-btn pill-btn-red diff-hunk-btn tooltip-host"
                  data-tooltip="Discard this hunk"
                  onClick={() => onDiscardHunk?.(hunk)}
                >
                  Discard Hunk
                </button>
                <button
                  type="button"
                  className="pill-btn pill-btn-green diff-hunk-btn tooltip-host"
                  data-tooltip="Stage this hunk"
                  onClick={() => onStageHunk?.(hunk)}
                >
                  Stage Hunk
                </button>
              </>
            )}
          </span>
        )}
      </div>
    );
  };

  // One diff line as a row (unified) or as one side of a split row. `gutters`
  // picks the line numbers shown; `discard` places the row's "Discard line"
  // button (in split, only one side of a pair carries it).
  const lineCell = (
    index: number,
    gutters: 'both' | 'old' | 'new',
    discard: boolean,
    key?: string | number,
  ) => {
    const line = diff.lines[index];
    const sign = line.kind === 'add' ? '+' : line.kind === 'delete' ? '−' : '';
    const actionable = lineButtons && line.kind !== 'context';
    const classes = ['diff-line', `diff-line-${line.kind}`];
    if (selectedRows.has(index)) classes.push('is-line-selected');
    if (targetRows.has(index)) classes.push('is-line-target');
    const gutterProps = actionable
      ? {
          className: 'diff-gutter is-selectable',
          onClick: (event: React.MouseEvent) => selectRow(index, event),
        }
      : { className: 'diff-gutter' };
    const firstNumber = gutters === 'new' ? line.newLine : line.oldLine;
    return (
      <div key={key ?? index} className={classes.join(' ')} role={key === undefined ? 'row' : 'cell'}>
        <span {...gutterProps}>
          {actionable && lineButton(primaryAction, index)}
          {firstNumber ?? ''}
        </span>
        {gutters === 'both' && <span {...gutterProps}>{line.newLine ?? ''}</span>}
        <span className="diff-sign" aria-hidden="true">
          {sign}
        </span>
        <span
          className="diff-code hljs"
          dangerouslySetInnerHTML={{ __html: highlightLine(line.text, lang) }}
        />
        {actionable && discard && linesMode === 'unstaged' && (
          <span className="diff-line-end">{lineButton('discard', index)}</span>
        )}
      </div>
    );
  };

  // A split row: the old side's line (or a blank) beside the new side's. A
  // context line appears on both sides. The discard button rides on the new
  // side when it's a change there, otherwise on the old side.
  const changed = (index: number | null) =>
    index !== null && diff.lines[index].kind !== 'context';
  const blank = (key: string | number) => (
    <div key={key} className="diff-line diff-line-empty" role="cell" aria-hidden="true" />
  );
  const splitRow = (left: number | null, right: number | null, key: string) => {
    return (
      <div key={key} className="diff-split-row" role="row">
        {left === null ? blank('l') : lineCell(left, 'old', !changed(right), 'l')}
        {right === null ? blank('r') : lineCell(right, 'new', changed(right), 'r')}
      </div>
    );
  };

  // The floating actions for a multi-line selection.
  const selectionBar = (
    lineButtons && selectedRefs.length > 0 && (
      <div className="diff-selection-bar" role="toolbar" aria-label="Selected lines">
        <span className="diff-selection-count">
          {selectedRefs.length} {selectedRefs.length === 1 ? 'line' : 'lines'} selected
        </span>
        {linesMode === 'unstaged' ? (
          <>
            <button
              type="button"
              className="pill-btn pill-btn-red diff-hunk-btn"
              disabled={lineBusy}
              onClick={() => onLines?.('discard', selectedRefs)}
            >
              Discard
            </button>
            <button
              type="button"
              className="pill-btn pill-btn-green diff-hunk-btn"
              disabled={lineBusy}
              onClick={() => onLines?.('stage', selectedRefs)}
            >
              Stage
            </button>
          </>
        ) : (
          <button
            type="button"
            className="pill-btn pill-btn-red diff-hunk-btn"
            disabled={lineBusy}
            onClick={() => onLines?.('unstage', selectedRefs)}
          >
            Unstage
          </button>
        )}
        <button
          type="button"
          className="diff-selection-clear tooltip-host"
          data-tooltip="Clear selection (Esc)"
          aria-label="Clear selection"
          onClick={() => {
            setSelectedRows(new Set());
            setAnchorRow(null);
          }}
        >
          <CloseIcon size={10} />
        </button>
      </div>
    )
  );

  // One side of an unwrapped split: every display row, drawn for that side
  // only, at the same fixed row heights as the other pane so the two line up.
  const splitPane = (side: 'old' | 'new') => {
    const ref = side === 'old' ? oldPaneRef : newPaneRef;
    const other = side === 'old' ? newPaneRef : oldPaneRef;
    return (
      <div
        className={`diff-scroll diff-split-pane is-${side}`}
        ref={ref}
        onScroll={(event) => {
          mirrorScroll(event.currentTarget, other.current);
          reportNav();
        }}
      >
        <div className="diff-lines" role="table">
          {displayRows.map((row, i) => {
            if (row.kind === 'hunk') return hunkRow(row.index, row.hunk, side === 'new', i);
            if (row.kind === 'line') return null;
            const index = side === 'old' ? row.left : row.right;
            if (index === null) return blank(i);
            const discard = side === 'new' ? changed(row.right) : !changed(row.right);
            return lineCell(index, side, discard, i);
          })}
        </div>
      </div>
    );
  };

  const linesClass = ['diff-lines'];
  if (layout === 'split') linesClass.push('diff-lines-split');
  if (wrap) linesClass.push('is-wrap');
  if (layout === 'split' && !wrap) {
    return (
      <>
        <div className="diff-split-panes">
          {splitPane('old')}
          {splitPane('new')}
        </div>
        {selectionBar}
      </>
    );
  }
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
      <div
        className="diff-scroll"
        ref={scrollRef}
        onScroll={() => {
          sync();
          reportNav();
        }}
      >
        <div className={linesClass.join(' ')} role="table">
          {displayRows.map((row) =>
            row.kind === 'hunk'
              ? hunkRow(row.index, row.hunk)
              : row.kind === 'line'
                ? lineCell(row.index, 'both', true)
                : splitRow(row.left, row.right, `${row.left ?? ''}:${row.right ?? ''}`),
          )}
        </div>
      </div>
      {selectionBar}
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
  wrap = false,
  blame,
  onPickRev,
}: BlameColumn & { content: string[] | null; lang: string | null; wrap?: boolean }) {
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
        <div className={`diff-lines diff-lines-file${wrap ? ' is-wrap' : ''}`} role="table">
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
