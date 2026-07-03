import { useState } from 'react';
import { ChevronDownIcon, PullIcon } from '../../../../../assets/icons';
import { useOutsideDismiss } from './useOutsideDismiss';

/** Selectable pull/fetch modes. The first-listed default is fast-forward. */
const PULL_ACTIONS = [
  'Pull (fast-forward is possible)',
  'Pull (fast-forward only)',
  'Pull (rebase)',
  'Fetch All',
] as const;

type PullActionMode = (typeof PULL_ACTIONS)[number];

const DEFAULT_MODE: PullActionMode = 'Pull (fast-forward is possible)';

/**
 * Split button: the main part runs the current default pull action; the caret
 * opens a menu to pick which action is the default. Inert this pass — only the
 * selection is real (local state).
 */
export function PullAction() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PullActionMode>(DEFAULT_MODE);
  const rootRef = useOutsideDismiss<HTMLDivElement>(open, () => setOpen(false));

  const choose = (next: PullActionMode) => {
    setMode(next);
    setOpen(false);
  };

  return (
    <div className="pull-action" ref={rootRef}>
      <button
        type="button"
        className="repo-action pull-action-main tooltip-host"
        data-tooltip={mode}
      >
        <span className="repo-action-label">Pull</span>
        <PullIcon size={18} />
      </button>
      <button
        type="button"
        className="pull-action-caret"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose default pull action"
        onClick={() => setOpen((prev) => !prev)}
      >
        <ChevronDownIcon size={14} />
      </button>

      {open && (
        <div className="pull-action-menu" role="menu">
          {PULL_ACTIONS.map((action) => (
            <button
              key={action}
              type="button"
              role="menuitemradio"
              aria-checked={action === mode}
              className={
                action === mode
                  ? 'pull-action-option is-current'
                  : 'pull-action-option'
              }
              onClick={() => choose(action)}
            >
              {action}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
