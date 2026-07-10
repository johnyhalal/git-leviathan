import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RepoActivityEvent } from '../../../../types/ipc';

interface ActivityLogProps {
  /** The repo whose git activity this footer shows; events for others are ignored. */
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
 * A footer activity log for the open repository. Subscribes to the main
 * process' live git activity stream and shows each mutation's output —
 * including the output of repository hooks (a `pre-commit` test run, a
 * `pre-push` check) — line by line as it happens. Collapsed, it shows a status
 * dot and the latest line; expanded, the full session transcript. State is
 * in-memory and per session: it resets when the tab switches to another repo.
 */
export function ActivityLog({ repoPath }: ActivityLogProps) {
  const [records, setRecords] = useState<LogRecord[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  // The outcome of the last finished command, for the collapsed status dot.
  const [lastOk, setLastOk] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
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
      if (event.repoPath !== repoPath) return;
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

  // Keep the newest output in view while the panel is open.
  useLayoutEffect(() => {
    if (expanded && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [records, expanded]);

  const last = records[records.length - 1];
  const summary = running
    ? `Running git ${running}…`
    : last?.text?.trim() ||
      (lastOk === false ? 'Last command failed' : records.length ? 'Done' : 'No activity yet');

  const dotClass = running
    ? 'activity-dot activity-dot--running'
    : lastOk === false
      ? 'activity-dot activity-dot--error'
      : lastOk
        ? 'activity-dot activity-dot--ok'
        : 'activity-dot';

  return (
    <div className={`activity-log${expanded ? ' activity-log--expanded' : ''}`}>
      {expanded && (
        <div className="activity-log__body" ref={bodyRef}>
          {records.length === 0 ? (
            <div className="activity-line activity-line--muted">
              Git output — including hook output like a pre-commit test run — appears here.
            </div>
          ) : (
            records.map((record) => <ActivityRow key={record.id} record={record} />)
          )}
        </div>
      )}
      <button
        type="button"
        className="activity-log__bar"
        onClick={() => setExpanded((on) => !on)}
        title={expanded ? 'Hide activity log' : 'Show activity log'}
      >
        <span className={dotClass} />
        <span className="activity-log__summary">{summary}</span>
        <span className="activity-log__chevron">{expanded ? '▾' : '▴'}</span>
      </button>
    </div>
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
      {record.text || ' '}
    </div>
  );
}
