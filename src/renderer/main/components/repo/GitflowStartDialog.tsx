import { useEffect, useState } from 'react';
import { CheckIcon, CloseIcon, GearIcon } from '../../../../../assets/icons';
import type { GitflowConfig, GitflowKind } from '../../../../types/ipc';

const cx = (...parts: (string | false | undefined)[]) =>
  parts.filter(Boolean).join(' ');

const KINDS: { kind: GitflowKind; label: string }[] = [
  { kind: 'feature', label: 'Feature' },
  { kind: 'release', label: 'Release' },
  { kind: 'hotfix', label: 'Hotfix' },
];

/** The configured topic-branch prefix for a gitflow kind. */
function prefixOf(config: GitflowConfig, kind: GitflowKind): string {
  return kind === 'feature'
    ? config.featurePrefix
    : kind === 'release'
      ? config.releasePrefix
      : config.hotfixPrefix;
}

/** The configured base branch a gitflow kind conventionally starts from. */
function baseOf(config: GitflowConfig, kind: GitflowKind): string {
  return kind === 'hotfix' ? config.mainBranch : config.developBranch;
}

/** Which gitflow kind `branch` belongs to by its configured prefix, or null. */
export function gitflowKindOf(
  config: GitflowConfig,
  branch: string | undefined,
): GitflowKind | null {
  if (!branch) return null;
  return KINDS.find(({ kind }) => branch.startsWith(prefixOf(config, kind)))?.kind ?? null;
}

interface GitflowStartDialogProps {
  /** The repo's gitflow config (drives prefixes and the default source). */
  config: GitflowConfig;
  /** The checked-out branch, offered as a source and used to enable Finish. */
  currentBranch: string | undefined;
  /** Candidate source branches (local + remote names). */
  branchOptions: string[];
  /** Start `<prefix><name>` of `kind`, based off `source`. */
  onStart: (kind: GitflowKind, name: string, source: string) => void;
  /** Finish the current gitflow topic branch. */
  onFinish: () => void;
  /** Open the gitflow settings dialog (the gear). */
  onOpenSettings: () => void;
  /** Dismiss the dialog. */
  onClose: () => void;
  /**
   * When another dialog (the settings dialog) is layered on top, this dialog
   * stays mounted underneath but stops reacting to Escape / backdrop clicks so
   * those dismiss only the topmost dialog.
   */
  suspended?: boolean;
}

/**
 * The "start a gitflow branch" dialog. Uses the same overlay/panel shell as the
 * Settings and new-PR dialogs. Pick a kind (feature/release/hotfix), type the
 * branch name — the configured prefix is shown fixed alongside it — and choose
 * the source branch to start from (defaulting to the kind's configured base, e.g.
 * develop, but any branch works, including the current one). A gear reopens the
 * settings dialog, and a Finish action appears when a gitflow branch is checked
 * out.
 */
export function GitflowStartDialog({
  config,
  currentBranch,
  branchOptions,
  onStart,
  onFinish,
  onOpenSettings,
  onClose,
  suspended = false,
}: GitflowStartDialogProps) {
  const [kind, setKind] = useState<GitflowKind>('feature');

  // Source options: the repo's real branches (plus the checked-out one), so a
  // pick always resolves to an existing ref. Independent of the selected kind.
  const sourceOptions = (() => {
    const names = new Set(branchOptions);
    if (currentBranch) names.add(currentBranch);
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  })();

  /** The sensible default source for a kind: its base branch, else the current one. */
  const defaultSource = (nextKind: GitflowKind): string => {
    const base = baseOf(config, nextKind);
    if (sourceOptions.includes(base)) return base;
    if (currentBranch && sourceOptions.includes(currentBranch)) return currentBranch;
    return sourceOptions[0] ?? '';
  };

  const [name, setName] = useState('');
  const [source, setSource] = useState(() => defaultSource('feature'));

  const chooseKind = (nextKind: GitflowKind) => {
    setKind(nextKind);
    setSource(defaultSource(nextKind));
  };

  useEffect(() => {
    if (suspended) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, suspended]);

  const prefix = prefixOf(config, kind);
  const trimmed = name.trim();
  const canStart = trimmed.length > 0;
  const currentKind = gitflowKindOf(config, currentBranch);
  const kindLabel = KINDS.find(({ kind: k }) => k === kind)?.label ?? '';

  const submit = () => {
    if (!canStart) return;
    onStart(kind, trimmed, source);
    onClose();
  };

  return (
    <div
      className={cx('settings-overlay', suspended && 'is-suspended')}
      aria-hidden={suspended || undefined}
      onClick={suspended ? undefined : onClose}
    >
      <div
        className="settings-panel gitflow-start-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Start a gitflow branch"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>Start a branch</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <form
          className="settings-content pr-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="gitflow-field">
            <span className="gitflow-field-label">Type</span>
            <div className="gitflow-kind-tabs" role="tablist" aria-label="Branch kind">
              {KINDS.map(({ kind: k, label }) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={kind === k}
                  className={cx('gitflow-kind-tab', kind === k && 'is-active')}
                  onClick={() => chooseKind(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="gitflow-field">
            <span className="gitflow-field-label">Name</span>
            <span className="gitflow-name-row">
              <span className="gitflow-prefix" title={prefix}>
                {prefix}
              </span>
              <input
                className="gitflow-name-input"
                autoFocus
                value={name}
                placeholder="name"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => setName(event.target.value)}
              />
            </span>
          </label>

          <label className="gitflow-field">
            <span className="gitflow-field-label">From</span>
            <select
              className="gitflow-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              {sourceOptions.length === 0 && <option value="">(current branch)</option>}
              {sourceOptions.map((branchName) => (
                <option key={branchName} value={branchName}>
                  {branchName === baseOf(config, kind) ? `${branchName} (default)` : branchName}
                </option>
              ))}
            </select>
          </label>

          <div className="gitflow-dialog-footer">
            <div className="gitflow-dialog-footer-left">
              <button
                type="button"
                className="gitflow-settings-link tooltip-host"
                aria-label="Gitflow settings"
                data-tooltip="Gitflow settings"
                onClick={onOpenSettings}
              >
                <GearIcon size={16} />
              </button>
              {currentKind && (
                <button
                  type="button"
                  className="gitflow-finish-btn tooltip-host"
                  data-tooltip={`Finish ${currentBranch} into its base branch`}
                  onClick={() => {
                    onFinish();
                    onClose();
                  }}
                >
                  <CheckIcon size={14} />
                  <span>Finish {currentBranch}</span>
                </button>
              )}
            </div>
            <div className="gitflow-dialog-footer-right">
              <button type="button" className="pill-btn pill-btn-gray" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="pill-btn pill-btn-green gitflow-start-btn"
                disabled={!canStart}
              >
                Start {kindLabel.toLowerCase()}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
