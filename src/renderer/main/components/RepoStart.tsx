import { useMemo, useState } from 'react';
import {
  CloneIcon,
  CloseIcon,
  FolderIcon,
  FolderPlusIcon,
  SearchIcon,
  StarIcon,
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
  onToggleFavorite: (repo: RecentRepo) => void;
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
  onToggleFavorite,
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

  // Favorites float to the top, sorted A→Z; the rest keep the incoming
  // most-recently-opened-first order.
  const favorites = useMemo(
    () =>
      filtered
        .filter((repo) => repo.favorite)
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        ),
    [filtered],
  );
  const others = useMemo(
    () => filtered.filter((repo) => !repo.favorite),
    [filtered],
  );

  const renderItem = (repo: RecentRepo) => (
    <li key={repo.path}>
      {/* A div (not a button) so real remove/star <button>s can nest inside
          it — nesting <button> in <button> is invalid HTML. */}
      <div
        className="repo-recent-item tooltip-host"
        role="button"
        tabIndex={0}
        onClick={() => onSelectRecent(repo)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelectRecent(repo);
          }
        }}
        data-tooltip={repo.path}
      >
        <button
          type="button"
          className={`repo-recent-star tooltip-host${repo.favorite ? ' is-favorite' : ''}`}
          aria-label={
            repo.favorite
              ? `Unstar ${repo.name}`
              : `Star ${repo.name} as favorite`
          }
          aria-pressed={repo.favorite ?? false}
          data-tooltip={repo.favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(repo);
          }}
        >
          <StarIcon size={16} filled={repo.favorite ?? false} />
        </button>
        <span className="repo-recent-text">
          <span className="repo-recent-name">{repo.name}</span>
          <span className="repo-recent-path">{repo.path}</span>
        </span>
        <button
          type="button"
          className="repo-recent-remove tooltip-host"
          aria-label={`Remove ${repo.name} from recent`}
          data-tooltip="Remove from recent"
          onClick={(event) => {
            event.stopPropagation();
            onRemoveRecent(repo);
          }}
        >
          <CloseIcon size={14} />
        </button>
      </div>
    </li>
  );

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
            <>
              {favorites.length > 0 && (
                <>
                  <h3 className="repo-recent-group-title">Favorites</h3>
                  <ul className="repo-recent-list">
                    {favorites.map(renderItem)}
                  </ul>
                </>
              )}
              {others.length > 0 && (
                <>
                  {favorites.length > 0 && (
                    <h3 className="repo-recent-group-title">Recent</h3>
                  )}
                  <ul className="repo-recent-list">{others.map(renderItem)}</ul>
                </>
              )}
            </>
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
