import { useState } from 'react';
import type { StashPushOptions } from '../../../../types/ipc';
import { ChevronDownIcon, StashIcon } from '../../../../../assets/icons';
import { useOutsideDismiss } from './useOutsideDismiss';
import { useConfirm } from '../ConfirmBar';
import { useCommands } from '../../commands/CommandRegistry';
import { withShortcut } from '../../commands/keys';

/** A stash variant offered from the caret menu (and the command palette). */
interface StashVariant {
  /** Palette command id. */
  id: string;
  label: string;
  /** Prompt shown in the confirm bar above the message input. */
  prompt: string;
  options: StashPushOptions;
  /** Only offered when something is staged. */
  needsStaged?: boolean;
}

const STASH_VARIANTS: StashVariant[] = [
  {
    id: 'stash:message',
    label: 'Stash with message…',
    prompt: 'Stash all changes?',
    options: {},
  },
  {
    id: 'stash:keep-index',
    label: 'Stash, keep staged changes…',
    prompt: 'Stash all changes, keeping the staged ones in place?',
    options: { keepIndex: true },
  },
  {
    id: 'stash:staged',
    label: 'Stash staged changes only…',
    prompt: 'Stash only the staged changes?',
    options: { stagedOnly: true },
    needsStaged: true,
  },
  {
    id: 'stash:tracked',
    label: 'Stash tracked files only…',
    prompt: 'Stash changes to tracked files, leaving untracked files?',
    options: { includeUntracked: false },
  },
];

interface StashActionProps {
  /** Stash the working tree's changes; no options is the one-click default. */
  onStash: (options?: StashPushOptions) => void;
  /** Whether there are uncommitted changes to stash. */
  canStash: boolean;
  /** Whether anything is staged (enables "staged changes only"). */
  hasStaged: boolean;
  /** The checked-out branch, for the default-message placeholder. */
  branch: string;
}

/**
 * Split button: the main part stashes everything (untracked included) with the
 * default message; the caret offers stash variants, each asking for an optional
 * message in the confirm bar over the toolbar.
 */
export function StashAction({ onStash, canStash, hasStaged, branch }: StashActionProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useOutsideDismiss<HTMLDivElement>(open, () => setOpen(false));
  const requestConfirm = useConfirm();

  const enabled = (variant: StashVariant) =>
    canStash && (!variant.needsStaged || hasStaged);

  const run = (variant: StashVariant) => {
    setOpen(false);
    requestConfirm({
      message: variant.prompt,
      input: { placeholder: `WIP on ${branch}`, ariaLabel: 'Stash message' },
      actions: [
        {
          label: 'Stash',
          tone: 'primary',
          busyLabel: 'Stashing…',
          onClick: (message) => onStash({ ...variant.options, message }),
        },
      ],
    });
  };

  useCommands(
    STASH_VARIANTS.map((variant) => ({
      id: variant.id,
      label: variant.label,
      category: 'Repository',
      run: () => run(variant),
      enabled: enabled(variant),
    })),
  );

  return (
    <div className="pull-action" ref={rootRef}>
      <button
        type="button"
        className={`repo-action pull-action-main tooltip-host${canStash ? '' : ' is-disabled'}`}
        data-tooltip={canStash ? withShortcut('Stash your uncommitted changes', 'repo.stash') : 'No changes to stash'}
        onClick={() => canStash && onStash()}
        aria-disabled={!canStash}
      >
        <span className="repo-action-label">Stash</span>
        <StashIcon size={18} />
      </button>
      <button
        type="button"
        className="pull-action-caret"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More stash options"
        onClick={() => setOpen((prev) => !prev)}
      >
        <ChevronDownIcon size={14} />
      </button>

      {open && (
        <div className="pull-action-menu" role="menu">
          {STASH_VARIANTS.map((variant) => (
            <button
              key={variant.id}
              type="button"
              role="menuitem"
              className="pull-action-option"
              disabled={!enabled(variant)}
              onClick={() => run(variant)}
            >
              {variant.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
