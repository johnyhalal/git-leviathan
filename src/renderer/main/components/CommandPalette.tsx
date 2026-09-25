import { useEffect, useMemo, useRef, useState } from 'react';
import { useCommandList, type ResolvedCommand } from '../commands/CommandRegistry';

interface CommandPaletteProps {
  /** Close the palette, then run the chosen command (by id), if any. */
  onClose: (runId?: string) => void;
}

/** Categories in display order; anything else falls in after them. */
const CATEGORY_ORDER = ['Repository', 'Branches', 'Tabs', 'App'];

/**
 * Score `label` against `query` as a case-insensitive subsequence match, or
 * null when it doesn't match. Consecutive runs and word-start hits score higher,
 * so "psh" ranks "Push" above "Pop Stash".
 */
function score(label: string, query: string): number | null {
  if (!query) return 0;
  const text = label.toLowerCase();
  let total = 0;
  let from = 0;
  let prev = -2;
  for (const ch of query.toLowerCase()) {
    if (ch === ' ') continue;
    const at = text.indexOf(ch, from);
    if (at === -1) return null;
    total += 1;
    if (at === prev + 1) total += 3;
    if (at === 0 || /[\s:/._-]/.test(text[at - 1])) total += 2;
    prev = at;
    from = at + 1;
  }
  // Prefer shorter labels among equal matches.
  return total - text.length / 100;
}

/**
 * The command palette: a filterable list of every command that can run right
 * now, triggered by ⌘P. It's a standard popup (settings overlay shell); arrow
 * keys move the highlight, Enter runs it, Escape or a click outside closes.
 */
export function CommandPalette({ onClose }: CommandPaletteProps) {
  const commands = useCommandList();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Ranked matches, grouped by category (groups kept in a fixed order).
  const results = useMemo(() => {
    const matched: { command: ResolvedCommand; score: number }[] = [];
    for (const command of commands) {
      if (command.id === 'palette') continue;
      const s = score(`${command.category}: ${command.label}`, query.trim()) ?? score(command.label, query.trim());
      if (s !== null) matched.push({ command, score: s });
    }
    const rank = (category: string) => {
      const i = CATEGORY_ORDER.indexOf(category);
      return i === -1 ? CATEGORY_ORDER.length : i;
    };
    matched.sort((a, b) =>
      query.trim()
        ? b.score - a.score
        : rank(a.command.category) - rank(b.command.category),
    );
    return matched.map((entry) => entry.command);
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[active];
      if (chosen) onClose(chosen.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="settings-overlay command-palette-overlay" onClick={() => onClose()}>
      <div
        className="settings-panel command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          className="command-palette-input"
          autoFocus
          placeholder="Type a command…"
          aria-label="Search commands"
          aria-controls="command-palette-list"
          aria-activedescendant={results[active] ? `command-${active}` : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="command-palette-list" id="command-palette-list" role="listbox" ref={listRef}>
          {results.length === 0 && <div className="command-palette-empty">No matching commands</div>}
          {results.map((command, index) => (
            <div
              key={command.id}
              id={`command-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === active}
              className={`command-palette-item${index === active ? ' is-active' : ''}`}
              onMouseMove={() => setActive(index)}
              onClick={() => onClose(command.id)}
            >
              <span className="command-palette-category">{command.category}</span>
              <span className="command-palette-label">{command.label}</span>
              {command.shortcut && <kbd className="command-palette-kbd">{command.shortcut}</kbd>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
