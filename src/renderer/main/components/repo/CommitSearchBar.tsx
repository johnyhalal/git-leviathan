import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  SearchIcon,
} from '../../../../../assets/icons';

interface CommitSearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Index of the focused match, or -1 when there's none. */
  current: number;
  /** How many matches the search returned. */
  total: number;
  /** Whether the main process cut the match list short. */
  truncated: boolean;
  /** Whether a search for the current query is still in flight. */
  searching: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  /** Bumped to re-focus (and select) the input, e.g. on a repeat ⌘F. */
  focusToken: number;
}

/**
 * The floating commit-search bar shown beside the toolbar's magnifier: an
 * input, a match counter, previous/next steppers and a close button. Purely
 * presentational — RepoView owns the query, results and navigation.
 */
export function CommitSearchBar({
  query,
  onQueryChange,
  current,
  total,
  truncated,
  searching,
  onPrev,
  onNext,
  onClose,
  focusToken,
}: CommitSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (total === 0) return;
    if (event.shiftKey) onPrev();
    else onNext();
  };

  // Escape closes the bar from anywhere inside it (a keyboard-focused button
  // included), not just the input.
  const handleBarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onClose();
  };

  // Clicking a button shouldn't pull focus off the input: typing, Enter and
  // Escape keep working, and the button doesn't pick up a focus ring.
  const keepInputFocus = (event: MouseEvent<HTMLButtonElement>) => event.preventDefault();

  let counter = '';
  if (query.trim() && !searching) {
    const count = `${total}${truncated ? '+' : ''}`;
    if (total === 0) counter = 'No results';
    else if (current < 0) counter = `${count} ${total === 1 ? 'match' : 'matches'}`;
    else counter = `${current + 1} / ${count}`;
  }

  return (
    <div className="commit-search-bar" role="search" onKeyDown={handleBarKeyDown}>
      <span className="commit-search-glyph">
        <SearchIcon size={14} />
      </span>
      <input
        ref={inputRef}
        className="commit-search-input"
        type="text"
        value={query}
        placeholder="Search message, author or hash"
        aria-label="Search commits"
        spellCheck={false}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleInputKeyDown}
      />
      <span className="commit-search-count" aria-live="polite">
        {counter}
      </span>
      <button
        type="button"
        className="commit-search-button tooltip-host"
        onMouseDown={keepInputFocus}
        data-tooltip="Previous match (⇧Enter)"
        aria-label="Previous match"
        onClick={onPrev}
        disabled={total === 0}
      >
        <ChevronUpIcon size={16} />
      </button>
      <button
        type="button"
        className="commit-search-button tooltip-host"
        onMouseDown={keepInputFocus}
        data-tooltip="Next match (Enter)"
        aria-label="Next match"
        onClick={onNext}
        disabled={total === 0}
      >
        <ChevronDownIcon size={16} />
      </button>
      <button
        type="button"
        className="commit-search-button tooltip-host"
        onMouseDown={keepInputFocus}
        data-tooltip="Close search (Esc)"
        aria-label="Close search"
        onClick={onClose}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
