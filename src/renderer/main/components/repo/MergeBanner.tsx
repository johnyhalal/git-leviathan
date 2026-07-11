import type { MergeState } from '../../../../types/ipc';

/**
 * The strip shown above the columns while a merge/rebase/cherry-pick/revert or
 * stash-pop is stopped on conflicts. Summarizes the operation and offers the
 * relevant recovery actions — open the resolver, continue (only once every file
 * is resolved), abort, or skip (rebase only).
 */
interface MergeBannerProps {
  state: MergeState;
  onResolve: () => void;
  onContinue: () => void;
  onAbort: () => void;
  onSkip: () => void;
  /** Disables the buttons while a continue/abort/skip is in flight. */
  busy?: boolean;
}

export function MergeBanner({
  state,
  onResolve,
  onContinue,
  onAbort,
  onSkip,
  busy,
}: MergeBannerProps) {
  const remaining = state.conflicts.length;
  const resolved = remaining === 0;

  return (
    <div className="merge-banner" role="status">
      <div className="merge-banner-info">
        <span className="merge-banner-title">{state.description}</span>
        {state.step && (
          <span className="merge-banner-step">
            step {state.step.current}/{state.step.total}
          </span>
        )}
        <span className={`merge-banner-count${resolved ? ' is-clear' : ''}`}>
          {resolved
            ? 'all conflicts resolved'
            : `${remaining} conflicted file${remaining === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="merge-banner-actions">
        {!resolved && (
          <button className="merge-banner-button is-primary" onClick={onResolve}>
            Resolve conflicts
          </button>
        )}
        {state.canContinue && (
          <button
            className="merge-banner-button is-primary"
            disabled={busy || !resolved}
            onClick={onContinue}
          >
            Continue
          </button>
        )}
        {state.canSkip && (
          <button className="merge-banner-button" disabled={busy} onClick={onSkip}>
            Skip
          </button>
        )}
        {state.op !== 'stash-pop' && (
          <button className="merge-banner-button is-danger" disabled={busy} onClick={onAbort}>
            Abort
          </button>
        )}
      </div>
    </div>
  );
}
