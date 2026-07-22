import { useEffect, useState } from 'react';
import { CloseIcon } from '../../../../../assets/icons';
import type { LfsResult, LfsStatus } from '../../../../types/ipc';

interface RepoLfsPanelProps {
  /** The repository whose Git LFS state this panel manages. */
  repoPath: string;
}

/**
 * The repo settings' Git LFS tab: add/remove the patterns this repo stores with
 * Git LFS. The app bundles git-lfs, and tracking lazily runs `git lfs install
 * --local`, so there's no availability/version/enable UI — just the patterns.
 */
export function RepoLfsPanel({ repoPath }: RepoLfsPanelProps) {
  const [status, setStatus] = useState<LfsStatus | null>(null);
  const [pattern, setPattern] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setStatus(null);
    void window.api.repo.repoLfsStatus(repoPath).then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, [repoPath]);

  // Run an LFS mutation, then fold its fresh status (or error) into local state.
  const run = async (action: () => Promise<LfsResult>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.status === 'ok') setStatus(result.lfs);
    else setError(result.message);
    return result.status === 'ok';
  };

  const track = async () => {
    const value = pattern.trim();
    if (!value || busy) return;
    if (await run(() => window.api.repo.repoLfsTrack(repoPath, value))) setPattern('');
  };

  if (!status) {
    return <p className="settings-empty">Loading Git LFS…</p>;
  }

  return (
    <div className="lfs-panel">
      <form
        className="pr-form-field lfs-track-form"
        onSubmit={(event) => {
          event.preventDefault();
          void track();
        }}
      >
        <span className="pr-form-label">Track a pattern</span>
        <div className="lfs-track-row">
          <input
            value={pattern}
            placeholder="*.psd"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => setPattern(event.target.value)}
          />
          <button
            type="submit"
            className="pill-btn pill-btn-green"
            disabled={busy || pattern.trim().length === 0}
          >
            Track
          </button>
        </div>
        <span className="gitflow-form-hint">
          Files matching the pattern are stored with Git LFS (written to <code>.gitattributes</code>).
        </span>
      </form>

      <div className="pr-form-field">
        <span className="pr-form-label">Tracked patterns</span>
        {status.patterns.length === 0 ? (
          <p className="settings-empty">No patterns are tracked yet.</p>
        ) : (
          <ul className="lfs-patterns">
            {status.patterns.map((item) => (
              <li key={item} className="lfs-pattern">
                <code className="lfs-pattern-name">{item}</code>
                <button
                  type="button"
                  className="icon-button lfs-pattern-remove tooltip-host"
                  data-tooltip={`Untrack ${item}`}
                  aria-label={`Untrack ${item}`}
                  disabled={busy}
                  onClick={() => void run(() => window.api.repo.repoLfsUntrack(repoPath, item))}
                >
                  <CloseIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="pr-form-error">{error}</p>}
    </div>
  );
}
