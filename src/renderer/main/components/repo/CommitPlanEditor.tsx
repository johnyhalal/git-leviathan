import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { RebaseCommitInfo, RebaseTodoEntry, RebaseTodoOp } from '../../../../types/ipc';
import { CloseIcon } from '../../../../../assets/icons';

/**
 * The shared commit-plan editor — GitLeviathan's GitKraken-style surface for
 * reordering a list of commits and setting one of four operations per commit
 * (pick / reword / squash / drop). Two features drive it: interactive rebase
 * (the base commit's children, replayed onto it) and multi-commit cherry-pick
 * (the selected commits, replayed onto HEAD). Both list oldest→newest — the
 * order git applies them — let the user drag to reorder, and reveal an inline
 * message field for a reword. On submit the ordered plan is compiled to a
 * {@link RebaseTodoEntry} list and handed up via `onSubmit`.
 */
interface CommitPlanEditorProps {
  /** Dialog heading and aria label, e.g. "Interactive rebase". */
  title: string;
  /** Intro copy under the header explaining the ordering. */
  intro: ReactNode;
  /** The commits to plan, oldest first (apply order). */
  commits: RebaseCommitInfo[];
  /** Submit-button label when idle, e.g. "Start rebase". */
  submitLabel: string;
  /** Submit-button label while running, e.g. "Rebasing…". */
  busyLabel: string;
  /**
   * When true (interactive rebase), a no-op plan — every commit picked in its
   * original order — is disallowed, since it would rewrite history to no effect.
   * When false (cherry-pick), any plan is a real action and submit stays enabled.
   */
  requireChange?: boolean;
  /** Run the compiled plan; resolves when it finishes (success or error). */
  onSubmit: (todo: RebaseTodoEntry[]) => Promise<void>;
  onClose: () => void;
}

/** One editable row: the commit, its chosen op, and any edited reword message. */
interface Row {
  commit: RebaseCommitInfo;
  op: RebaseTodoOp;
  /** The reword draft; seeded from the commit's full message, edited in place. */
  message: string;
}

const OPS: { op: RebaseTodoOp; label: string; key: string; hint: string }[] = [
  { op: 'pick', label: 'Pick', key: 'P', hint: 'Keep this commit as-is' },
  { op: 'reword', label: 'Reword', key: 'R', hint: 'Keep the commit, edit its message' },
  { op: 'squash', label: 'Squash', key: 'S', hint: 'Meld into the commit above' },
  { op: 'drop', label: 'Drop', key: 'D', hint: 'Remove this commit' },
];

/**
 * Compile the ordered rows into a git todo plan. Squash melds a commit into the
 * previous kept commit; the melded message (previous message + each squashed
 * message, git's default) is attached to the *last* squash of each run so a
 * single trailing `commit --amend` sets it. A squash with no commit above it is
 * demoted to a pick (git can't squash the first line).
 */
export function compilePlan(rows: Row[]): RebaseTodoEntry[] {
  const entries: RebaseTodoEntry[] = [];
  const kept = rows.filter((r) => r.op !== 'drop');
  let leaderFinal: string | null = null;
  let meld: string[] = [];

  kept.forEach((row, i) => {
    const isSquash = row.op === 'squash' && leaderFinal !== null;
    if (isSquash) {
      meld.push(row.commit.body);
      const next = kept[i + 1];
      const lastOfRun = !next || next.op !== 'squash';
      entries.push({
        hash: row.commit.hash,
        op: 'squash',
        ...(lastOfRun ? { message: [leaderFinal, ...meld].join('\n\n') } : {}),
      });
    } else {
      // A leader (pick/reword) — or a squash with nothing above, demoted to pick.
      const op: RebaseTodoOp = row.op === 'squash' ? 'pick' : row.op;
      leaderFinal = op === 'reword' ? row.message : row.commit.body;
      meld = [];
      entries.push({
        hash: row.commit.hash,
        op,
        ...(op === 'reword' ? { message: row.message } : {}),
      });
    }
  });
  return entries;
}

export function CommitPlanEditor({
  title,
  intro,
  commits,
  submitLabel,
  busyLabel,
  requireChange = false,
  onSubmit,
  onClose,
}: CommitPlanEditorProps) {
  const [rows, setRows] = useState<Row[]>(() =>
    commits.map((commit) => ({ commit, op: 'pick', message: commit.body })),
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, busy]);

  const keptCount = useMemo(() => rows.filter((r) => r.op !== 'drop').length, [rows]);
  // A reword with an empty message can't be committed — block the run on it.
  const emptyReword = useMemo(
    () => rows.some((r) => r.op === 'reword' && r.message.trim().length === 0),
    [rows],
  );
  // For rebase, a no-op plan (every commit picked, original order) isn't worth a
  // rewrite; for cherry-pick every plan applies commits, so it's always "changed".
  const changed = useMemo(
    () =>
      !requireChange ||
      rows.some((r, i) => r.op !== 'pick' || r.commit.hash !== commits[i]?.hash),
    [rows, commits, requireChange],
  );

  const setOp = (index: number, op: RebaseTodoOp) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, op } : row)));

  const setMessage = (index: number, message: string) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, message } : row)));

  const move = (from: number, to: number) =>
    setRows((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const next = [...prev];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });

  const start = async () => {
    if (busy || keptCount === 0 || !changed || emptyReword) return;
    setBusy(true);
    try {
      await onSubmit(compilePlan(rows));
      // On success the view reloads under us; on a handled error the caller keeps
      // this open only if it chooses to — here we simply close after the attempt.
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-overlay" onClick={busy ? undefined : onClose}>
      <div
        className="settings-panel rebase-editor"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <p className="rebase-editor-intro">{intro}</p>

        <div className="rebase-rows">
          {rows.map((row, index) => (
            <div
              key={row.commit.hash}
              className={
                'rebase-row' +
                (row.op === 'drop' ? ' is-dropped' : '') +
                (row.op === 'squash' ? ' is-squash' : '') +
                (overIndex === index && dragIndex !== null ? ' is-drop-target' : '')
              }
              draggable={!busy}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => {
                event.preventDefault();
                setOverIndex(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== null) move(dragIndex, index);
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
            >
              <div className="rebase-row-main">
                <span className="rebase-grip" aria-hidden>
                  ⠿
                </span>
                <div className="rebase-ops" role="group" aria-label="Action">
                  {OPS.map((choice) => (
                    <button
                      key={choice.op}
                      type="button"
                      className={
                        'rebase-op' + (row.op === choice.op ? ' is-active' : '')
                      }
                      data-op={choice.op}
                      data-tooltip={choice.hint}
                      aria-pressed={row.op === choice.op}
                      disabled={busy}
                      onClick={() => setOp(index, choice.op)}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
                <code className="rebase-hash">{row.commit.shortHash}</code>
                <span className="rebase-subject">{row.commit.subject || '(no message)'}</span>
                <span className="rebase-author">{row.commit.author}</span>
                <span className="rebase-reorder">
                  <button
                    type="button"
                    className="rebase-nudge"
                    aria-label="Move up"
                    disabled={busy || index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="rebase-nudge"
                    aria-label="Move down"
                    disabled={busy || index === rows.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    ↓
                  </button>
                </span>
              </div>
              {row.op === 'reword' && (
                <textarea
                  className="rebase-message"
                  value={row.message}
                  spellCheck={false}
                  disabled={busy}
                  aria-label={`New message for ${row.commit.shortHash}`}
                  onChange={(event) => setMessage(index, event.target.value)}
                />
              )}
            </div>
          ))}
        </div>

        <footer className="rebase-editor-footer">
          <span className="rebase-editor-status">
            {keptCount === 0
              ? 'Every commit is dropped — keep at least one.'
              : `${keptCount} commit${keptCount === 1 ? '' : 's'} kept`}
          </span>
          <div className="rebase-editor-actions">
            <button type="button" className="pill-btn pill-btn-gray" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="pill-btn pill-btn-green"
              disabled={busy || keptCount === 0 || !changed || emptyReword}
              onClick={() => void start()}
            >
              {busy ? busyLabel : submitLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
