import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  CloseIcon,
  SearchIcon,
} from '../../../../../assets/icons';
import type { RemoteRepo } from '../../../../types/ipc';

interface RepoComboboxProps {
  /** Full repository list to search/select from. */
  repos: RemoteRepo[];
  /** Controlled search text (kept in the dialog so it persists). */
  query: string;
  onQueryChange: (query: string) => void;
  /** Controlled selection (kept in the dialog so it persists). */
  selected: RemoteRepo | null;
  onSelect: (repo: RemoteRepo | null) => void;
  loading: boolean;
  error: string | null;
  /** Shown in the menu when the account has no repositories at all. */
  emptyMessage?: string;
}

/**
 * A single field that is both a search input and a dropdown: click to open a
 * scrollable, filterable list; pick a repo to fill the field (with a clear ×);
 * the down-chevron toggles the list.
 */
export function RepoCombobox({
  repos,
  query,
  onQueryChange,
  selected,
  onSelect,
  loading,
  error,
  emptyMessage,
}: RepoComboboxProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside the widget.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return repos;
    return repos.filter((repo) =>
      repo.fullName.toLowerCase().includes(needle),
    );
  }, [repos, query]);

  // Group the visible repos by their owner/organization (the part of
  // `fullName` before the last slash), with the groups ordered A→Z.
  const groups = useMemo(() => {
    const byOrg = new Map<string, RemoteRepo[]>();
    for (const repo of filtered) {
      const slash = repo.fullName.lastIndexOf('/');
      const org = slash === -1 ? repo.fullName : repo.fullName.slice(0, slash);
      const list = byOrg.get(org);
      if (list) list.push(repo);
      else byOrg.set(org, [repo]);
    }
    return [...byOrg.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map(([organization, orgRepos]) => ({ organization, repos: orgRepos }));
  }, [filtered]);

  // While open, the field shows the query (search mode); closed, it shows the
  // selected repo's name.
  const value = open ? query : selected?.fullName ?? '';

  const choose = (repo: RemoteRepo) => {
    onSelect(repo);
    onQueryChange('');
    setOpen(false);
  };

  const clear = () => {
    onSelect(null);
    onQueryChange('');
    setOpen(true);
    inputRef.current?.focus();
  };

  return (
    <div
      className="repo-combobox"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          // Close only the dropdown. Stop the native event so the dialog's
          // window-level Escape handler doesn't also close the whole dialog.
          event.nativeEvent.stopImmediatePropagation();
          setOpen(false);
        }
      }}
    >
      <div className="repo-combobox-field">
        <SearchIcon size={16} />
        <input
          ref={inputRef}
          type="text"
          className="repo-combobox-input"
          role="combobox"
          aria-expanded={open}
          aria-controls="repo-combobox-menu"
          placeholder={selected ? selected.fullName : 'Search repositories…'}
          value={value}
          onChange={(event) => {
            onQueryChange(event.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
          spellCheck={false}
        />
        {selected && (
          <button
            type="button"
            className="repo-combobox-clear"
            aria-label="Clear selection"
            onClick={clear}
          >
            <CloseIcon size={14} />
          </button>
        )}
        <button
          type="button"
          className="repo-combobox-toggle"
          aria-label={open ? 'Close list' : 'Open list'}
          onClick={() => {
            setOpen((prev) => !prev);
            inputRef.current?.focus();
          }}
        >
          <ChevronDownIcon size={16} />
        </button>
      </div>

      {open && (
        <div className="repo-combobox-menu" id="repo-combobox-menu" role="listbox">
          {loading && <p className="settings-empty">Loading repositories…</p>}
          {error && <p className="settings-empty github-repo-error">{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="settings-empty">
              {repos.length > 0
                ? 'No repositories match your search.'
                : emptyMessage ?? 'No repositories found for this account.'}
            </p>
          )}
          {!loading &&
            !error &&
            groups.map((group) => (
              <div
                key={group.organization}
                role="group"
                aria-label={group.organization}
              >
                <div className="repo-combobox-group" aria-hidden="true">
                  {group.organization}
                </div>
                {group.repos.map((repo) => (
                  <button
                    key={repo.fullName}
                    type="button"
                    role="option"
                    aria-selected={repo.fullName === selected?.fullName}
                    className="github-repo repo-combobox-option"
                    onClick={() => choose(repo)}
                  >
                    <span className="github-repo-head">
                      <span className="github-repo-name">{repo.name}</span>
                      {repo.private && (
                        <span className="github-badge">Private</span>
                      )}
                    </span>
                    {repo.description && (
                      <span className="github-repo-desc">{repo.description}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
