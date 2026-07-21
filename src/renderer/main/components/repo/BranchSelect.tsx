import { useMemo, useState } from 'react';
import {
  BranchIcon,
  ChevronDownIcon,
  SearchIcon,
} from '../../../../../assets/icons';
import { useOutsideDismiss } from './useOutsideDismiss';

interface BranchSelectProps {
  branch: string;
  /** All local branch names to choose from. */
  branches: string[];
  onSelect: (branch: string) => void;
}

/**
 * The checked-out-branch pill. Clicking it opens a dropdown with a search box
 * to narrow a scrollable list of the repo's local branches. Selection is local
 * for now (no checkout is wired yet).
 */
export function BranchSelect({ branch, branches, onSelect }: BranchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useOutsideDismiss<HTMLDivElement>(open, () => setOpen(false));

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return branches;
    return branches.filter((name) => name.toLowerCase().includes(needle));
  }, [query, branches]);

  const choose = (name: string) => {
    setOpen(false);
    setQuery('');
    if (name !== branch) onSelect(name);
  };

  return (
    <div className="branch-select" ref={rootRef}>
      <button
        type="button"
        className="repo-branch-pill tooltip-host"
        data-tooltip={branch}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <BranchIcon size={16} />
        <span className="repo-branch-name">{branch}</span>
        <ChevronDownIcon size={16} />
      </button>

      {open && (
        <div className="branch-select-menu" role="listbox">
          <div className="branch-select-search">
            <SearchIcon size={16} />
            <input
              type="text"
              className="branch-select-input"
              placeholder="Search branches…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="branch-select-list">
            {filtered.length === 0 ? (
              <p className="branch-select-empty">No branches match.</p>
            ) : (
              filtered.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={name === branch}
                  className={
                    name === branch
                      ? 'branch-select-option is-current'
                      : 'branch-select-option'
                  }
                  onClick={() => choose(name)}
                >
                  <BranchIcon size={14} />
                  <span>{name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
