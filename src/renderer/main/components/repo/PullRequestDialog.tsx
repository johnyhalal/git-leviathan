import { useEffect } from 'react';
import { CloseIcon, BranchIcon } from '../../../../../assets/icons';
import type {
  IntegrationProvider,
  PullRequestState,
  PullRequestSummary,
} from '../../../../types/ipc';

const PR_STATE_LABEL: Record<PullRequestState, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

const PROVIDER_LABEL: Record<IntegrationProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
};

/** Format an ISO timestamp as a short local date, or '' when absent/unparseable. */
function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

interface PullRequestDialogProps {
  pull: PullRequestSummary;
  provider: IntegrationProvider;
  onClose: () => void;
}

/**
 * Detail view for a single pull/merge request, shown as a modal over the app
 * (same overlay/panel treatment as the Settings dialog). Read-only: it shows
 * the metadata and description and offers a jump to the PR's web page.
 */
export function PullRequestDialog({ pull, provider, onClose }: PullRequestDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const created = formatDate(pull.createdAt);
  const updated = formatDate(pull.updatedAt);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel pr-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Pull request #${pull.number}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div className="pr-dialog-heading">
            <span className={`repo-pr-state pr-state-${pull.state}`}>
              {PR_STATE_LABEL[pull.state]}
            </span>
            <h2>
              <span className="pr-dialog-number">#{pull.number}</span> {pull.title}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="settings-content pr-dialog-body">
          <div className="pr-dialog-meta">
            <span className="pr-dialog-author">
              {pull.authorAvatarUrl && (
                <img
                  className="pr-dialog-avatar"
                  src={pull.authorAvatarUrl}
                  alt=""
                  width={20}
                  height={20}
                />
              )}
              {pull.author}
            </span>
            <span className="pr-dialog-branches">
              <BranchIcon size={13} />
              <span className="pr-dialog-branch">{pull.sourceBranch || '?'}</span>
              <span className="pr-dialog-arrow">→</span>
              <span className="pr-dialog-branch">{pull.targetBranch || '?'}</span>
            </span>
          </div>

          {(created || updated) && (
            <p className="pr-dialog-dates">
              {created && <span>Opened {created}</span>}
              {updated && <span>Updated {updated}</span>}
            </p>
          )}

          {pull.body ? (
            <pre className="pr-dialog-description">{pull.body}</pre>
          ) : (
            <p className="pr-dialog-empty">No description provided.</p>
          )}
        </div>

        <footer className="pr-dialog-footer">
          <button
            type="button"
            className="pill-btn pill-btn-gray"
            onClick={() => window.api.app.openExternal(pull.url)}
          >
            Open on {PROVIDER_LABEL[provider]}
          </button>
        </footer>
      </div>
    </div>
  );
}
