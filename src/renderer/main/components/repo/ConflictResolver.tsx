import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon, SparkleIcon } from '../../../../../assets/icons';
import type {
  ConflictFile,
  ConflictFileContent,
  ConflictKind,
  MergeResolution,
  MergeState,
  ResolveBlockRequest,
} from '../../../../types/ipc';
import { MergeEditor, type MergeEditorHandle } from './MergeEditor';

interface ConflictResolverProps {
  repoPath: string;
  mergeState: MergeState;
  /** File to pre-select when opened (e.g. clicked in the commit panel); the
   * first conflict is used when null or no longer conflicted. */
  initialFile?: string | null;
  /** Apply a fresh merge state after resolving a file (may be null once done). */
  onResolved: (next: MergeState | null) => void;
  /** Stage `file` exactly as it is on disk, without using the editor's result. */
  onMarkAsIs: (file: string) => Promise<void>;
  /** Surface a failure (e.g. a Claude request) as an error toast. */
  onError?: (title: string, message: string) => void;
  /** Open Settings at a section — used to send the user to connect Claude. */
  onOpenSettings?: (section?: string) => void;
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
  onMarkAsIs,
  onError,
  onOpenSettings,
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
  const editorRef = useRef<MergeEditorHandle>(null);
  // A whole-file Auto Resolve is running.
  const [autoResolving, setAutoResolving] = useState(false);

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

  const markAsIs = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await onMarkAsIs(selected);
    } finally {
      setBusy(false);
    }
  }, [selected, busy, onMarkAsIs]);

  // One conflict block to Claude; failures become a toast and a null answer.
  const askClaude = useCallback(
    async (request: ResolveBlockRequest) => {
      try {
        const result = await window.api.claude.resolveConflictBlock(repoPath, request);
        if (result.status === 'ok') return { lines: result.lines, rationale: result.rationale };
        if (result.status === 'not-connected') {
          // Not connected yet — send the user straight to connect Claude Code.
          onOpenSettings?.('integrations');
        } else {
          onError?.('Claude could not resolve', result.message);
        }
      } catch (err) {
        onError?.('Claude could not resolve', err instanceof Error ? err.message : String(err));
      }
      return null;
    },
    [repoPath, onError, onOpenSettings],
  );

  // Auto Resolve every undecided conflict in the file. Checks the connection
  // up front so a disconnected Claude sends the user to Settings once, rather
  // than failing per block.
  const autoResolveFile = useCallback(async () => {
    if (!editorRef.current || autoResolving) return;
    const status = await window.api.claude.status().catch(() => null);
    if (!status?.connected) {
      onOpenSettings?.('integrations');
      return;
    }
    setAutoResolving(true);
    try {
      await editorRef.current.autoResolveAll();
    } finally {
      setAutoResolving(false);
    }
  }, [autoResolving, onOpenSettings]);

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
              <MergeEditor
                content={content}
                onChange={setMerged}
                onPickSide={(side) => void resolve({ kind: side })}
                busy={busy}
                onAskClaude={askClaude}
                ref={editorRef}
              />
            )}

            {selected && (
              <footer className="merge-footer">
                {/* Only for a text file that still has undecided conflicts. */}
                {content && !content.binary && merged === null && (
                  <button
                    className="merge-auto-file pill-btn-rainbow"
                    disabled={busy || autoResolving}
                    onClick={() => void autoResolveFile()}
                    data-tooltip="Ask Claude to resolve every undecided conflict in this file"
                  >
                    {autoResolving ? (
                      <span className="mini-spinner" aria-hidden="true" />
                    ) : (
                      <SparkleIcon size={14} />
                    )}
                    {autoResolving ? 'Resolving…' : 'Auto Resolve File'}
                  </button>
                )}
                <button
                  className="merge-side-button merge-as-is tooltip-host"
                  disabled={busy}
                  onClick={() => void markAsIs()}
                  data-tooltip="Stage the file exactly as it is on disk, ignoring the editor"
                >
                  Mark resolved as-is
                </button>
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
