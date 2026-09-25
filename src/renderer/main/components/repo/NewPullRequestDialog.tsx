import { useEffect, useMemo, useState } from 'react';
import { CloseIcon } from '../../../../../assets/icons';
import type {
  IntegrationProvider,
  NewPullRequest,
  PullRequestSummary,
} from '../../../../types/ipc';

const PROVIDER_LABEL: Record<IntegrationProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
};

interface NewPullRequestDialogProps {
  /** The remote URL the PR is opened against (main resolves host/owner/repo). */
  remoteUrl: string;
  provider: IntegrationProvider;
  /** Candidate branch names for the source/target selects. */
  branches: string[];
  /** Pre-selected source branch (usually the checked-out branch). */
  defaultSource?: string;
  /** Pre-selected target branch (usually the default branch). */
  defaultTarget?: string;
  onClose: () => void;
  /** Called with the created PR once the host accepts it. */
  onCreated: (pull: PullRequestSummary) => void;
}

/**
 * Modal form for opening a new pull/merge request against the current repo's
 * host. Mirrors the Settings dialog's overlay/panel look. Source and target
 * branches are chosen from the repo's known branches; the call goes through
 * `integrations.createPullRequest`, which resolves host/owner/repo from the
 * remote URL.
 */
export function NewPullRequestDialog({
  remoteUrl,
  provider,
  branches,
  defaultSource,
  defaultTarget,
  onClose,
  onCreated,
}: NewPullRequestDialogProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [source, setSource] = useState(defaultSource ?? branches[0] ?? '');
  const [target, setTarget] = useState(
    defaultTarget ?? branches.find((b) => b !== (defaultSource ?? branches[0])) ?? '',
  );
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, busy]);

  const sameBranch = source === target;
  const canSubmit =
    !busy && title.trim().length > 0 && !!source && !!target && !sameBranch;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const input: NewPullRequest = {
      title: title.trim(),
      body: body.trim(),
      sourceBranch: source,
      targetBranch: target,
      draft,
    };
    const result = await window.api.integrations.createPullRequest(remoteUrl, input);
    setBusy(false);
    if (result.status === 'ok') {
      onCreated(result.pull);
      onClose();
    } else {
      setError(result.message);
    }
  };

  const branchOptions = useMemo(
    () =>
      branches.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      )),
    [branches],
  );

  return (
    <div className="settings-overlay" onClick={() => (busy ? undefined : onClose())}>
      <div
        className="settings-panel pr-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`New pull request on ${PROVIDER_LABEL[provider]}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>New pull request</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
          >
            <CloseIcon />
          </button>
        </header>

        <form
          className="settings-content form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="pr-branches">
            <label className="form-field">
              <span className="form-label">From</span>
              <select
                className="form-input"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              >
                {branchOptions}
              </select>
            </label>
            <span className="pr-branches-into">→</span>
            <label className="form-field">
              <span className="form-label">Into</span>
              <select
                className="form-input"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                {branchOptions}
              </select>
            </label>
          </div>

          {sameBranch && (
            <p className="form-hint form-hint-warn">
              Choose two different branches to compare.
            </p>
          )}

          <label className="form-field">
            <span className="form-label">Title</span>
            <input
              className="form-input"
              autoFocus
              value={title}
              placeholder="Summarize the change"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="form-field">
            <span className="form-label">Description</span>
            <textarea
              className="form-input"
              value={body}
              rows={8}
              placeholder="Describe what changed and why (optional)"
              onChange={(event) => setBody(event.target.value)}
            />
          </label>

          <label className="form-check">
            <input
              type="checkbox"
              checked={draft}
              onChange={(event) => setDraft(event.target.checked)}
            />
            <span>Open as a draft</span>
          </label>

          {error && <p className="form-error">{error}</p>}

          <div className="form-footer">
            <button
              type="button"
              className="pill-btn pill-btn-gray"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="pill-btn pill-btn-green"
              disabled={!canSubmit}
            >
              {busy ? 'Creating…' : 'Create pull request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
