import { useMemo, useState } from 'react';
import {
  CloneIcon,
  FolderIcon,
  FolderPlusIcon,
  SearchIcon,
} from '../../../../assets/icons';
import type { RepoInfo } from '../../../types/ipc';

/** A previously opened repository, surfaced in the "Recent" list. */
export type RecentRepo = RepoInfo;

interface RepoStartProps {
  recent: RecentRepo[];
  onOpen: () => void;
  onClone: () => void;
  onCreate: () => void;
  onSelectRecent: (repo: RecentRepo) => void;
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

        <section className="repo-recent" aria-label="Recent repositories">
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

          <h2 className="repo-recent-title">Recent</h2>

          {filtered.length > 0 ? (
            <ul className="repo-recent-list">
              {filtered.map((repo) => (
                <li key={repo.path}>
                  <button
                    type="button"
                    className="repo-recent-item"
                    onClick={() => onSelectRecent(repo)}
                    title={repo.path}
                  >
                    <span className="repo-recent-name">{repo.name}</span>
                    <span className="repo-recent-path">{repo.path}</span>
                  </button>
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
