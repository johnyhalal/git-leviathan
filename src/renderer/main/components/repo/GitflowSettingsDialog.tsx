import { useEffect, useState } from 'react';
import { CloseIcon } from '../../../../../assets/icons';
import type { GitflowConfig, GitflowConfigResult } from '../../../../types/ipc';

/** Fallback values shown when the repo has no gitflow config yet. */
const DEFAULTS: GitflowConfig = {
  mainBranch: 'main',
  developBranch: 'develop',
  featurePrefix: 'feature/',
  releasePrefix: 'release/',
  hotfixPrefix: 'hotfix/',
};

interface GitflowSettingsDialogProps {
  /** The current config to pre-fill from, or null when not yet configured. */
  config: GitflowConfig | null;
  /** Persist the config; resolves with the saved config or an error message. */
  onSave: (config: GitflowConfig) => Promise<GitflowConfigResult>;
  onClose: () => void;
  /** Called with the saved config once it lands (dialog then closes). */
  onSaved?: (config: GitflowConfig) => void;
}

interface Field {
  key: keyof GitflowConfig;
  label: string;
  hint: string;
  placeholder: string;
}

/** Left column: the two long-lived base branches. */
const BRANCH_FIELDS: Field[] = [
  { key: 'mainBranch', label: 'Main branch', hint: 'Production branch (git-flow’s “master”).', placeholder: 'main' },
  { key: 'developBranch', label: 'Develop branch', hint: 'Integration branch features and releases branch off.', placeholder: 'develop' },
];

/** Right column: the three topic-branch prefixes. */
const PREFIX_FIELDS: Field[] = [
  { key: 'featurePrefix', label: 'Feature prefix', hint: 'Prefix for feature branches (keep the trailing /).', placeholder: 'feature/' },
  { key: 'releasePrefix', label: 'Release prefix', hint: 'Prefix for release branches.', placeholder: 'release/' },
  { key: 'hotfixPrefix', label: 'Hotfix prefix', hint: 'Prefix for hotfix branches.', placeholder: 'hotfix/' },
];

const FIELDS: Field[] = [...BRANCH_FIELDS, ...PREFIX_FIELDS];

/**
 * Modal form for the repo's gitflow settings. Mirrors the Settings/new-PR
 * dialog's overlay/panel look. Values are stored in the repository's own git
 * config (the standard git-flow keys) by the main process, so they interoperate
 * with the `git flow` CLI. Saving with no prior config is what first "enables"
 * gitflow for the repo.
 */
export function GitflowSettingsDialog({
  config,
  onSave,
  onClose,
  onSaved,
}: GitflowSettingsDialogProps) {
  const [values, setValues] = useState<GitflowConfig>(config ?? DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, busy]);

  const setField = (key: keyof GitflowConfig, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const canSubmit =
    !busy && FIELDS.every(({ key }) => values[key].trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const trimmed: GitflowConfig = {
      mainBranch: values.mainBranch.trim(),
      developBranch: values.developBranch.trim(),
      featurePrefix: values.featurePrefix.trim(),
      releasePrefix: values.releasePrefix.trim(),
      hotfixPrefix: values.hotfixPrefix.trim(),
    };
    const result = await onSave(trimmed);
    setBusy(false);
    if (result.status === 'ok') {
      onSaved?.(result.config);
      onClose();
    } else {
      setError(result.message);
    }
  };

  const renderField = ({ key, label, hint, placeholder }: Field, autoFocus: boolean) => (
    <label key={key} className="pr-form-field">
      <span className="pr-form-label">{label}</span>
      <input
        autoFocus={autoFocus}
        value={values[key]}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event) => setField(key, event.target.value)}
      />
      <span className="gitflow-form-hint">{hint}</span>
    </label>
  );

  return (
    <div className="settings-overlay" onClick={() => (busy ? undefined : onClose())}>
      <div
        className="settings-panel gitflow-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Gitflow settings"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>Gitflow settings</h2>
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
          className="settings-content pr-form gitflow-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="gitflow-form-columns">
            <div className="gitflow-form-column">
              {BRANCH_FIELDS.map((field) => renderField(field, field.key === 'mainBranch'))}
            </div>
            <div className="gitflow-form-column">
              {PREFIX_FIELDS.map((field) => renderField(field, false))}
            </div>
          </div>

          {error && <p className="pr-form-error">{error}</p>}

          <div className="pr-dialog-footer">
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
              {busy ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
