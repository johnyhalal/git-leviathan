import { useEffect, useMemo, useState } from 'react';
import {
  BranchIcon,
  ChevronDownIcon,
  RemoteIcon,
  SearchIcon,
} from '../../../../../assets/icons';
import { useOutsideDismiss } from './useOutsideDismiss';
import type { WorktreeBranchOption } from './WorktreeDialog';

interface WorktreeBranchSelectProps {
  /** The selected ref, or '' when nothing is chosen yet. */
  value: string;
  /** Every local and remote branch, listed distinctly. */
  options: WorktreeBranchOption[];
  /** Shown on the trigger while nothing is selected. */
  placeholder: string;
  onChange: (ref: string) => void;
}

/**
 * Custom dropdown for the worktree dialog's "Check out" field. Unlike a native
 * `<select>` it can badge each entry with an icon — a branch glyph for local refs,
 * a remote glyph for remote-tracking ones — so local vs remote is visible at a
 * glance. A search box narrows the list; selection is by bare ref string.
 */
export function WorktreeBranchSelect({
  value,
  options,
  placeholder,
  onChange,
}: WorktreeBranchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useOutsideDismiss<HTMLDivElement>(open, () => setOpen(false));

  // While the menu is open, Escape closes just the menu — not the whole dialog.
  // The listener is registered in the capture phase and stops propagation so the
  // dialog's own (bubble-phase) Escape handler never sees the key.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      setQuery('');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  const selected = options.find((option) => option.ref === value);
  // A short list is easy to scan, so only offer search once it's worth it.
  const showSearch = options.length > 6;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.ref.toLowerCase().includes(needle));
  }, [query, options]);

  const choose = (ref: string) => {
    setOpen(false);
    setQuery('');
    onChange(ref);
  };

  return (
    <div className={open ? 'wt-select is-open' : 'wt-select'} ref={rootRef}>
      <button
        type="button"
        className="wt-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {selected ? (
          <>
            {selected.remote ? <RemoteIcon size={14} /> : <BranchIcon size={14} />}
            <span className="wt-select-value">{selected.ref}</span>
          </>
        ) : (
          <span className="wt-select-placeholder">{placeholder}</span>
        )}
        <ChevronDownIcon size={16} />
      </button>

      {open && (
        <div className="wt-select-menu" role="listbox">
          {showSearch && (
            <div className="wt-select-search">
              <SearchIcon size={16} />
              <input
                type="text"
                placeholder="Search branches…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
          <div className="wt-select-list">
            {filtered.length === 0 ? (
              <p className="wt-select-empty">No branches match.</p>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.ref}
                  type="button"
                  role="option"
                  aria-selected={option.ref === value}
                  className={
                    option.ref === value
                      ? 'wt-select-option is-selected'
                      : 'wt-select-option'
                  }
                  onClick={() => choose(option.ref)}
                >
                  {option.remote ? <RemoteIcon size={14} /> : <BranchIcon size={14} />}
                  <span>{option.ref}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
