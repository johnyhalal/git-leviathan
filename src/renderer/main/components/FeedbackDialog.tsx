import { useEffect, useState } from 'react';
import { CloseIcon, FeedbackIcon } from '../../../../assets/icons';
import type { FeedbackKind } from '../../../types/ipc';

interface FeedbackDialogProps {
  /** Called after an issue is filed, with its number and web URL. */
  onSubmitted: (issue: { number: number; url: string }) => void;
  onClose: () => void;
}

const KINDS: { id: FeedbackKind; label: string; hint: string }[] = [
  { id: 'bug', label: 'Bug report', hint: 'Something is broken or behaving unexpectedly.' },
  { id: 'feature', label: 'Feature request', hint: 'An idea or improvement you’d like to see.' },
];

/**
 * Modal for filing a bug report / feature request. Collects a type, a short
 * title and details, then opens a labelled GitHub issue on the app's own repo
 * through the connected GitHub account (see `integrations.submitFeedback`).
 */
export function FeedbackDialog({ onSubmitted, onClose }: FeedbackDialogProps) {
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const active = KINDS.find((k) => k.id === kind) ?? KINDS[0];
  const canSubmit = title.trim().length > 0 && details.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await window.api.integrations.submitFeedback({
        kind,
        title: title.trim(),
        details: details.trim(),
      });
      if (result.status === 'ok') {
        onSubmitted({ number: result.number, url: result.url });
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send feedback.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="settings-overlay"
      onClick={submitting ? undefined : onClose}
    >
      <div
        className="settings-panel feedback-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Send feedback"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>Send Feedback</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close feedback dialog"
            disabled={submitting}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="feedback-body">
          <p className="feedback-intro">
            This opens an issue on GitLeviathan’s GitHub repository using your
            connected GitHub account.
          </p>

          {error && <p className="feedback-error">{error}</p>}

          <div
            className="feedback-kinds"
            role="radiogroup"
            aria-label="Type of feedback"
          >
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={k.id === kind}
                className={
                  k.id === kind ? 'feedback-kind is-active' : 'feedback-kind'
                }
                onClick={() => setKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="feedback-hint">{active.hint}</p>

          <label className="feedback-label" htmlFor="feedback-title">
            Title
          </label>
          <input
            id="feedback-title"
            type="text"
            className="feedback-input"
            placeholder={
              kind === 'bug'
                ? 'Short summary of the problem'
                : 'Short summary of the idea'
            }
            value={title}
            maxLength={140}
            onChange={(event) => setTitle(event.target.value)}
          />

          <label className="feedback-label" htmlFor="feedback-details">
            Details
          </label>
          <textarea
            id="feedback-details"
            className="feedback-textarea"
            placeholder={
              kind === 'bug'
                ? 'What happened, what you expected, and steps to reproduce…'
                : 'Describe the feature and why it would help…'
            }
            value={details}
            rows={7}
            onChange={(event) => setDetails(event.target.value)}
          />

          <div className="feedback-actions">
            <button
              type="button"
              className="feedback-cancel"
              disabled={submitting}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="feedback-submit"
              disabled={!canSubmit || submitting}
              onClick={() => void submit()}
            >
              <FeedbackIcon size={16} />
              <span>{submitting ? 'Sending…' : 'Submit'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
