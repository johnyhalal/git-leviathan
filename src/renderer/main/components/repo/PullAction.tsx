import { useEffect, useState } from 'react';
import type { PullMode } from '../../../../types/ipc';
import { ChevronDownIcon, PullIcon } from '../../../../../assets/icons';
import { useOutsideDismiss } from './useOutsideDismiss';

/** Selectable pull/fetch actions. The first-listed default is fast-forward. */
const PULL_ACTIONS: { label: string; mode: PullMode }[] = [
  { label: 'Pull (fast-forward is possible)', mode: 'ff' },
  { label: 'Pull (fast-forward only)', mode: 'ff-only' },
  { label: 'Pull (rebase)', mode: 'rebase' },
  { label: 'Fetch All', mode: 'fetch-all' },
];

const DEFAULT_ACTION = PULL_ACTIONS[0];

const actionForMode = (mode: PullMode) =>
  PULL_ACTIONS.find((action) => action.mode === mode) ?? DEFAULT_ACTION;

interface PullActionProps {
  /** Run the given pull/fetch mode. */
  onPull: (mode: PullMode) => void;
  /** Whether a pull is in flight (disables the button, shows a busy label). */
  pulling: boolean;
}

/**
 * Split button: the main part runs the current default pull action; the caret
 * opens a menu to pick which action is the default. The selected default is
 * local state; running it is wired through to git.
 */
export function PullAction({ onPull, pulling }: PullActionProps) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState(DEFAULT_ACTION);
  const rootRef = useOutsideDismiss<HTMLDivElement>(open, () => setOpen(false));

  // The default action is a single global preference, restored on mount.
  useEffect(() => {
    let live = true;
    void window.api.app.getPullMode().then((mode) => {
      if (live) setAction(actionForMode(mode));
    });
    return () => {
      live = false;
    };
  }, []);

  const choose = (next: (typeof PULL_ACTIONS)[number]) => {
    setAction(next);
    setOpen(false);
    void window.api.app.setPullMode(next.mode);
  };

  const isFetch = action.mode === 'fetch-all';
  const busyLabel = isFetch ? 'Fetching…' : 'Pulling…';

  return (
    <div className="pull-action" ref={rootRef}>
      <button
        type="button"
        className="repo-action pull-action-main tooltip-host"
        data-tooltip={action.label}
        onClick={() => onPull(action.mode)}
        disabled={pulling}
      >
        <span className="repo-action-label">
          {pulling ? busyLabel : isFetch ? 'Fetch' : 'Pull'}
        </span>
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
          {PULL_ACTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="menuitemradio"
              aria-checked={option.mode === action.mode}
              className={
                option.mode === action.mode
                  ? 'pull-action-option is-current'
                  : 'pull-action-option'
              }
              onClick={() => choose(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
