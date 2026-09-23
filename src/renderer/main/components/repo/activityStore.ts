import { GLOBAL_ACTIVITY_PATH, type RepoActivityEvent } from '../../../../types/ipc';

/** One rendered row in the log: a command boundary or a line of git output. */
export interface LogRecord {
  id: number;
  op: string;
  kind: 'start' | 'line' | 'end';
  stream?: 'stdout' | 'stderr';
  text?: string;
  ok?: boolean;
  exitCode?: number;
  ts: number;
}

/** What the activity log renders for one repository. */
export interface ActivitySnapshot {
  records: LogRecord[];
  running: string | null;
  /** The outcome of the last finished command, for the status color. */
  lastOk: boolean | null;
}

/** One stream's retained history: a repo's own events, or the app-wide ones. */
interface Bucket {
  records: LogRecord[];
  running: string | null;
  lastOk: boolean | null;
  /** Id of the `end` record that set `lastOk`, to order it against the other bucket. */
  lastEndId: number;
  /** Records (incl. global ones) below this id were cleared from this repo's view. */
  clearedBefore: number;
}

/** Cap retained rows so a chatty hook can't grow the in-memory log unbounded. */
const MAX_RECORDS = 1000;

const EMPTY: ActivitySnapshot = { records: [], running: null, lastOk: null };

const buckets = new Map<string, Bucket>();
const snapshots = new Map<string, ActivitySnapshot>();
const listeners = new Set<() => void>();
let nextId = 0;
let subscribed = false;

function bucketFor(path: string): Bucket {
  let bucket = buckets.get(path);
  if (!bucket) {
    bucket = { records: [], running: null, lastOk: null, lastEndId: -1, clearedBefore: 0 };
    buckets.set(path, bucket);
  }
  return bucket;
}

function notify(path: string): void {
  // App-wide events show in every repo's log, so they invalidate every snapshot.
  if (path === GLOBAL_ACTIVITY_PATH) snapshots.clear();
  else snapshots.delete(path);
  listeners.forEach((listener) => listener());
}

function record(event: RepoActivityEvent): void {
  const bucket = bucketFor(event.repoPath);
  const entry: LogRecord = { id: nextId++, ...event };
  if (event.kind === 'start') bucket.running = event.op;
  else if (event.kind === 'end') {
    bucket.running = null;
    bucket.lastOk = event.ok ?? null;
    bucket.lastEndId = entry.id;
  }
  bucket.records.push(entry);
  if (bucket.records.length > MAX_RECORDS) {
    bucket.records = bucket.records.slice(bucket.records.length - MAX_RECORDS);
  }
  notify(event.repoPath);
}

/**
 * Start listening on first use and never stop, so activity from background
 * tabs (a push still running after switching away) is kept for when they return.
 */
function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  window.api.repo.onActivity(record);
}

export function subscribe(listener: () => void): () => void {
  ensureSubscribed();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The repo's transcript merged with app-wide events, stable until either changes. */
export function getSnapshot(repoPath: string): ActivitySnapshot {
  const cached = snapshots.get(repoPath);
  if (cached) return cached;
  const own = buckets.get(repoPath);
  const global = buckets.get(GLOBAL_ACTIVITY_PATH);
  if (!own && !global) return EMPTY;

  const cutoff = own?.clearedBefore ?? 0;
  const ownRecords = own?.records ?? [];
  const globalRecords = (global?.records ?? []).filter((r) => r.id >= cutoff);
  const records = globalRecords.length
    ? [...ownRecords, ...globalRecords].sort((a, b) => a.id - b.id)
    : ownRecords.slice();

  // Whichever stream finished a command most recently sets the status color.
  const ownEnd = own && own.lastEndId >= cutoff ? own.lastEndId : -1;
  const globalEnd = global && global.lastEndId >= cutoff ? global.lastEndId : -1;
  const lastOk =
    ownEnd > globalEnd ? own?.lastOk ?? null
      : globalEnd >= 0 ? global?.lastOk ?? null
        : null;

  const snapshot: ActivitySnapshot = {
    records,
    running: own?.running ?? global?.running ?? null,
    lastOk,
  };
  snapshots.set(repoPath, snapshot);
  return snapshot;
}

/**
 * Wipe one repo's transcript. An in-flight command keeps streaming into a
 * fresh log; other repos' histories are untouched.
 */
export function clear(repoPath: string): void {
  const bucket = bucketFor(repoPath);
  bucket.records = [];
  bucket.lastOk = null;
  bucket.clearedBefore = nextId;
  notify(repoPath);
}
