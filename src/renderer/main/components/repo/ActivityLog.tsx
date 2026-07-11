import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CloseIcon, ListIcon } from '../../../../../assets/icons';
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
              <h2>Activity</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close activity log"
                onClick={() => setOpen(false)}
              >
                <CloseIcon />
              </button>
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
  return (
    <div className={`activity-line${record.stream === 'stderr' ? ' activity-line--err' : ''}`}>
      {record.text || ' '}
    </div>
  );
}
