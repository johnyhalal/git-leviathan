import { useCallback, useEffect, useState } from 'react';
import { CloseIcon } from '../../../../../assets/icons';
import type {
  ConflictFile,
  ConflictFileContent,
  ConflictKind,
  MergeResolution,
  MergeState,
} from '../../../../types/ipc';
import { MergeEditor } from './MergeEditor';

interface ConflictResolverProps {
  repoPath: string;
  mergeState: MergeState;
  /** File to pre-select when opened (e.g. clicked in the commit panel); the
   * first conflict is used when null or no longer conflicted. */
  initialFile?: string | null;
  /** Apply a fresh merge state after resolving a file (may be null once done). */
  onResolved: (next: MergeState | null) => void;
  onClose: () => void;
}

const KIND_LABEL: Record<ConflictKind, string> = {
  'both-modified': 'both modified',
  'both-added': 'both added',
  'both-deleted': 'both deleted',
  'added-by-us': 'added by us',
  'added-by-them': 'added by them',
  'deleted-by-us': 'deleted by us',
  'deleted-by-them': 'deleted by them',
};

/** Base name for the rail label, keeping the directory as a dimmed prefix. */
function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/');
  return slash === -1
    ? { dir: '', name: path }
    : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

export function ConflictResolver({
  repoPath,
  mergeState,
  initialFile,
  onResolved,
  onClose,
}: ConflictResolverProps) {
  const conflicts = mergeState.conflicts;
  const [selected, setSelected] = useState<string | null>(
    (initialFile && conflicts.some((c) => c.path === initialFile) ? initialFile : conflicts[0]?.path) ??
      null,
  );
  const [content, setContent] = useState<ConflictFileContent | null>(null);
  const [merged, setMerged] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep a valid selection as the conflict list shrinks (resolved files drop off).
  useEffect(() => {
    if (conflicts.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !conflicts.some((c) => c.path === selected)) {
      setSelected(conflicts[0].path);
    }
  }, [conflicts, selected]);

  // Load the selected file's three sides for the editor.
  useEffect(() => {
    if (!selected) {
      setContent(null);
      return;
    }
    let live = true;
    setContent(null);
    setMerged(null);
    void window.api.repo.conflictFile(repoPath, selected).then((c) => {
      if (live) setContent(c);
    });
    return () => {
      live = false;
    };
  }, [repoPath, selected]);

  const resolve = useCallback(
    async (resolution: MergeResolution) => {
      if (!selected || busy) return;
      setBusy(true);
      const next = await window.api.repo.resolveFile(repoPath, selected, resolution);
      setBusy(false);
      onResolved(next);
    },
    [repoPath, selected, busy, onResolved],
  );

  const kind = conflicts.find((c) => c.path === selected)?.kind;
  // A both-deleted or binary conflict has no textual result to write — it's
  // resolved by picking a whole side (which removes or keeps the file).
  const canMarkResolved =
    merged !== null && kind !== 'both-deleted' && !content?.binary;

  return (
    <div className="merge-overlay" onClick={onClose}>
      <div
        className="merge-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Resolve conflicts"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="merge-header">
          <h2>
            Resolve conflicts
            <span className="merge-header-sub">{mergeState.description}</span>
          </h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        <div className="merge-body">
          <nav className="merge-rail" aria-label="Conflicted files">
            {conflicts.length === 0 ? (
              <p className="merge-rail-empty">All conflicts resolved.</p>
            ) : (
              conflicts.map((file: ConflictFile) => {
                const { dir, name } = splitPath(file.path);
                return (
                  <button
                    key={file.path}
                    className={`merge-rail-item tooltip-host${file.path === selected ? ' is-active' : ''}`}
                    onClick={() => setSelected(file.path)}
                    data-tooltip={file.path}
                  >
                    <span className="merge-rail-name">
                      {dir && <span className="merge-rail-dir">{dir}</span>}
                      {name}
                    </span>
                    <span className="merge-rail-kind">{KIND_LABEL[file.kind]}</span>
                  </button>
                );
              })
            )}
          </nav>

          <div className="merge-content">
            {!selected ? (
              <div className="merge-empty">Every conflict is resolved. You can continue.</div>
            ) : !content ? (
              <div className="merge-empty">Loading…</div>
            ) : (
              <MergeEditor content={content} onChange={setMerged} />
            )}

            {selected && (
              <footer className="merge-footer">
                <div className="merge-footer-sides">
                  <button
                    className="merge-side-button"
                    disabled={busy}
                    onClick={() => void resolve({ kind: 'ours' })}
                  >
                    Use ours (whole file)
                  </button>
                  <button
                    className="merge-side-button"
                    disabled={busy}
                    onClick={() => void resolve({ kind: 'theirs' })}
                  >
                    Use theirs (whole file)
                  </button>
                </div>
                {/* Tooltip lives on the wrapper span: a disabled button gets no
                    hover, so the "why it's disabled" hint would never show. */}
                <span
                  className="tooltip-host"
                  data-tooltip={
                    kind === 'both-deleted' || content?.binary
                      ? 'Pick a whole side for this file'
                      : merged === null
                        ? 'Decide every conflict first'
                        : undefined
                  }
                >
                  <button
                    className="clone-submit"
                    disabled={busy || !canMarkResolved}
                    onClick={() => merged !== null && void resolve({ kind: 'content', text: merged })}
                  >
                    Mark resolved
                  </button>
                </span>
              </footer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
