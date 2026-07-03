import { useMemo, useState } from 'react';
import {
  CloneIcon,
  CloseIcon,
  FolderIcon,
  FolderPlusIcon,
  SearchIcon,
} from '../../../../assets/icons';
import type { RecentRepo } from '../../../types/ipc';

/** A previously opened repository, surfaced in the "Recent" list. */
export type { RecentRepo };

interface RepoStartProps {
  recent: RecentRepo[];
  onOpen: () => void;
  onClone: () => void;
  onCreate: () => void;
  onSelectRecent: (repo: RecentRepo) => void;
  onRemoveRecent: (repo: RecentRepo) => void;
}

/**
 * The default content for a tab that has no repository open yet: primary
 * actions (open / clone / create) above a searchable list of recent repos.
 */
export function RepoStart({
  recent,
  onOpen,
  onClone,
  onCreate,
  onSelectRecent,
  onRemoveRecent,
}: RepoStartProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recent;
    return recent.filter(
      (repo) =>
        repo.name.toLowerCase().includes(q) ||
        repo.path.toLowerCase().includes(q),
    );
  }, [recent, query]);

  return (
    <div className="repo-start">
      <div className="repo-start-inner">
        <header className="repo-start-hero">
          <h1 className="repo-start-title">Repositories</h1>
          <div className="repo-actions">
            <button type="button" className="repo-action" onClick={onOpen}>
              <FolderIcon />
              <span>Open</span>
            </button>
            <button type="button" className="repo-action" onClick={onClone}>
              <CloneIcon />
              <span>Clone</span>
            </button>
            <button type="button" className="repo-action" onClick={onCreate}>
              <FolderPlusIcon />
              <span>Create</span>
            </button>
          </div>
        </header>

        <section className="repo-recent" aria-label="Recently opened repositories">
          <h2 className="repo-recent-title">Recently opened repositories</h2>

          <div className="repo-search">
            <SearchIcon />
            <input
                type="search"
                className="repo-search-input"
                placeholder="Search recent repositories"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search recent repositories"
            />
          </div>

          {filtered.length > 0 ? (
            <ul className="repo-recent-list">
              {filtered.map((repo) => (
                <li key={repo.path}>
                  {/* A div (not a button) so a real remove <button> can nest
                      inside it — nesting <button> in <button> is invalid HTML. */}
                  <div
                    className="repo-recent-item"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectRecent(repo)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectRecent(repo);
                      }
                    }}
                    title={repo.path}
                  >
                    <span className="repo-recent-name">{repo.name}</span>
                    <span className="repo-recent-path">{repo.path}</span>
                    <button
                      type="button"
                      className="repo-recent-remove"
                      aria-label={`Remove ${repo.name} from recent`}
                      title="Remove from recent"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveRecent(repo);
                      }}
                    >
                      <CloseIcon size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="repo-recent-empty">
              {recent.length === 0
                ? 'No recent repositories yet.'
                : 'No repositories match your search.'}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
