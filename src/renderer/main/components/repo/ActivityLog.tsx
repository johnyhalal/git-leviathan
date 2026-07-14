import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CheckIcon, CloseIcon, ListIcon } from '../../../../../assets/icons';
import { GLOBAL_ACTIVITY_PATH, type RepoActivityEvent } from '../../../../types/ipc';

interface ActivityLogProps {
  /** The repo whose git activity this indicator shows; events for others are ignored. */
  repoPath: string;
}

/** One rendered row in the log: a command boundary or a line of git output. */
interface LogRecord {
  id: number;
  op: string;
  kind: 'start' | 'line' | 'end';
  stream?: 'stdout' | 'stderr';
  text?: string;
  ok?: boolean;
  exitCode?: number;
  ts: number;
}

/** Cap retained rows so a chatty hook can't grow the in-memory log unbounded. */
const MAX_RECORDS = 1000;

/**
 * The live git activity indicator for the open repository. It lives in the
 * status bar's left corner as an icon plus a one-line status summary, and opens
 * a modal popup (styled like the Settings dialog) with the full session
 * transcript — each mutation's output line by line, including repository hook
 * output (a `pre-commit` test run, a `pre-push` check). State is in-memory and
 * per session: it resets when the tab switches to another repo.
 */
export function ActivityLog({ repoPath }: ActivityLogProps) {
  const [records, setRecords] = useState<LogRecord[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  // The outcome of the last finished command, for the status color.
  const [lastOk, setLastOk] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const idRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // A fresh repo starts a fresh transcript.
  useEffect(() => {
    setRecords([]);
    setRunning(null);
    setLastOk(null);
  }, [repoPath]);

  useEffect(() => {
    return window.api.repo.onActivity((event: RepoActivityEvent) => {
      // Show this repo's git activity plus app-wide events (e.g. auto-update).
      if (event.repoPath !== repoPath && event.repoPath !== GLOBAL_ACTIVITY_PATH) return;
      if (event.kind === 'start') setRunning(event.op);
      else if (event.kind === 'end') {
        setRunning(null);
        setLastOk(event.ok ?? null);
      }
      setRecords((prev) => {
        const next = prev.concat({ id: idRef.current++, ...event });
        return next.length > MAX_RECORDS ? next.slice(next.length - MAX_RECORDS) : next;
      });
    });
  }, [repoPath]);

  // Keep the newest output in view while the popup is open.
  useLayoutEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [records, open]);

  // Escape closes the popup, matching the Settings dialog.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const last = records[records.length - 1];
  const summary = running
    ? `Running git ${running}…`
    : last?.text?.trim() ||
      (lastOk === false ? 'Last command failed' : records.length ? 'Done' : 'No activity yet');

  const state = running ? 'running' : lastOk === false ? 'error' : lastOk ? 'ok' : 'idle';

  const copyTranscript = () => {
    const text = records.map(recordText).join('\n');
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // Wipe the transcript. The in-flight command (if any) keeps streaming into a
  // fresh log; the status summary drops back to idle for the cleared history.
  const clearLog = () => {
    setRecords([]);
    setLastOk(null);
    setCopied(false);
  };

  return (
    <>
      <button
        type="button"
        className={`activity-indicator activity-indicator--${state}`}
        onClick={() => setOpen(true)}
        title="Show activity log"
      >
        <ListIcon />
        <span className="activity-indicator__summary">{summary}</span>
      </button>

      {open && (
        <div className="settings-overlay" onClick={() => setOpen(false)}>
          <div
            className="settings-panel activity-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Activity log"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="settings-header">
              <h2>Activity Log</h2>
              <div className="activity-header__actions">
                {records.length > 0 && (
                  <button
                    type="button"
                    className="activity-copy-button"
                    onClick={copyTranscript}
                  >
                    {copied ? <CheckIcon /> : null}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
                {records.length > 0 && (
                  <button
                    type="button"
                    className="activity-copy-button"
                    onClick={clearLog}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close activity log"
                  onClick={() => setOpen(false)}
                >
                  <CloseIcon />
                </button>
              </div>
            </header>

            <div className="activity-log__body" ref={bodyRef}>
              {records.length === 0 ? (
                <div className="activity-line activity-line--muted">
                  Git output — including hook output like a pre-commit test run — appears here.
                </div>
              ) : (
                records.map((record) => <ActivityRow key={record.id} record={record} />)
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Serialize one transcript row to plain text, matching what ActivityRow renders. */
function recordText(record: LogRecord): string {
  if (record.kind === 'start') return `$ git ${record.op}`;
  if (record.kind === 'end') {
    return record.ok
      ? `✓ ${record.op} finished`
      : `✗ ${record.op} failed${record.exitCode != null ? ` (exit ${record.exitCode})` : ''}`;
  }
  return stripAnsi(record.text || '');
}

/** Render one transcript row: a command boundary header or a line of output. */
function ActivityRow({ record }: { record: LogRecord }) {
  if (record.kind === 'start') {
    return <div className="activity-line activity-line--cmd">$ git {record.op}</div>;
  }
  if (record.kind === 'end') {
    return (
      <div className={`activity-line activity-line--end${record.ok ? '' : ' activity-line--err'}`}>
        {record.ok
          ? `✓ ${record.op} finished`
          : `✗ ${record.op} failed${record.exitCode != null ? ` (exit ${record.exitCode})` : ''}`}
      </div>
    );
  }
  const text = record.text || ' ';
  // Colored hook output (a Pest/PHPUnit run) carries its own ANSI colors — honor
  // them and skip the blanket stderr-red, which otherwise dyes the whole run red.
  const colored = text.includes(ANSI_ESC);
  const errClass = record.stream === 'stderr' && !colored ? ' activity-line--err' : '';
  return (
    <div className={`activity-line${errClass}`}>
      {colored ? renderAnsi(text) : text}
    </div>
  );
}

// --- ANSI SGR rendering -----------------------------------------------------
// Test runners and other git hooks emit ANSI color codes; render them as styled
// spans instead of leaking raw escape sequences into the transcript.

const ESC = '\u001b';
const ANSI_ESC = ESC + '[';

/** Theme-friendly palette for the 8 standard + 8 bright ANSI foreground colors. */
const FG_COLORS: Record<number, string> = {
  30: '#586069', 31: '#f85149', 32: '#3fb950', 33: '#d29922',
  34: '#58a6ff', 35: '#bc8cff', 36: '#39c5cf', 37: '#b1bac4',
  90: '#8b949e', 91: '#ff7b72', 92: '#56d364', 93: '#e3b341',
  94: '#79c0ff', 95: '#d2a8ff', 96: '#56d4dd', 97: '#f0f6fc',
};
/** Matching background palette (SGR 40–47 / 100–107). */
const BG_COLORS: Record<number, string> = {
  40: '#586069', 41: '#f85149', 42: '#3fb950', 43: '#d29922',
  44: '#58a6ff', 45: '#bc8cff', 46: '#39c5cf', 47: '#b1bac4',
  100: '#8b949e', 101: '#ff7b72', 102: '#56d364', 103: '#e3b341',
  104: '#79c0ff', 105: '#d2a8ff', 106: '#56d4dd', 107: '#f0f6fc',
};

/** Drop every ANSI escape sequence, leaving plain text (for copy + summaries). */
function stripAnsi(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === ESC) {
      i = skipEscape(text, i);
      continue;
    }
    out += text[i++];
  }
  return out;
}

/** Advance past an ANSI escape sequence starting at `i`, returning the next index. */
function skipEscape(text: string, i: number): number {
  if (text[i + 1] === '[') {
    let j = i + 2;
    while (j < text.length && !isFinalByte(text[j])) j++;
    return j + 1; // past the final byte
  }
  return i + 2; // a two-char escape (e.g. ESC + letter)
}

const isFinalByte = (ch: string) => ch >= '@' && ch <= '~';

/** Convert an xterm-256 color index to a CSS rgb() string. */
function xterm256(n: number): string {
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  if (n >= 16) {
    const i = n - 16;
    const step = (x: number) => (x === 0 ? 0 : 55 + x * 40);
    return `rgb(${step(Math.floor(i / 36))},${step(Math.floor((i % 36) / 6))},${step(i % 6)})`;
  }
  return FG_COLORS[n < 8 ? n + 30 : n + 82] ?? 'inherit';
}

/** Fold one SGR parameter list into the running style. */
function applySgr(style: CSSProperties, params: string): CSSProperties {
  const codes = params.split(';').map((p) => (p === '' ? 0 : Number(p)));
  const next: CSSProperties = { ...style };
  for (let k = 0; k < codes.length; k++) {
    const code = codes[k];
    if (code === 0) return {};
    else if (code === 1) next.fontWeight = 600;
    else if (code === 2) next.opacity = 0.65;
    else if (code === 3) next.fontStyle = 'italic';
    else if (code === 4) next.textDecoration = 'underline';
    else if (code === 22) { next.fontWeight = undefined; next.opacity = undefined; }
    else if (code === 39) next.color = undefined;
    else if (code === 49) next.background = undefined;
    else if (FG_COLORS[code]) next.color = FG_COLORS[code];
    else if (BG_COLORS[code]) next.background = BG_COLORS[code];
    else if (code === 38 || code === 48) {
      const target = code === 38 ? 'color' : 'background';
      if (codes[k + 1] === 5) { next[target] = xterm256(codes[k + 2]); k += 2; }
      else if (codes[k + 1] === 2) { next[target] = `rgb(${codes[k + 2] || 0},${codes[k + 3] || 0},${codes[k + 4] || 0})`; k += 4; }
    }
  }
  return next;
}

/** Parse an ANSI-colored line into an array of styled React spans. */
function renderAnsi(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let style: CSSProperties = {};
  let buffer = '';
  let key = 0;
  const flush = () => {
    if (!buffer) return;
    nodes.push(
      Object.keys(style).length
        ? <span key={key++} style={style}>{buffer}</span>
        : buffer,
    );
    buffer = '';
  };
  let i = 0;
  while (i < text.length) {
    if (text[i] === ESC) {
      // A colour change ends the current run; other escapes are just dropped.
      if (text[i + 1] === '[') {
        let j = i + 2;
        while (j < text.length && !isFinalByte(text[j])) j++;
        if (text[j] === 'm') {
          flush();
          style = applySgr(style, text.slice(i + 2, j));
        }
        i = j + 1;
      } else {
        i += 2;
      }
      continue;
    }
    buffer += text[i++];
  }
  flush();
  return nodes;
}
