import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BranchIcon, CloseIcon, PlusIcon, WorktreeIcon } from '../../../../assets/icons';

export interface Tab {
  id: string;
  /** Repository name shown on the tab. */
  title: string;
  /** Absolute path of the open repository, or undefined for an empty tab. */
  repoPath?: string;
  /**
   * True when the open repository is a linked worktree (added via
   * `git worktree add`) rather than a main working tree — shown with a tree icon.
   */
  isWorktree?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  /** Move the tab with `id` to occupy position `toIndex`. */
  onReorder: (id: string, toIndex: number) => void;
}

/** Left-aligned repository tabs in the top bar. */
export function TabBar({ tabs, activeId, onSelect, onClose, onAdd, onReorder }: TabBarProps) {
  // Id of the tab being dragged, and the index its drop would land on, so we
  // can show an insertion cue without mutating the list mid-drag.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // Whether the strip is scrolled away from each edge, so we can show a fade
  // cue (and enable it) only on the side that has hidden tabs.
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const stripRef = useRef<HTMLDivElement>(null);

  const endDrag = () => {
    setDragId(null);
    setDropIndex(null);
  };

  // Recompute which edges have off-screen tabs (on scroll, resize, or when the
  // set of tabs changes).
  const syncOverflow = () => {
    const el = stripRef.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  };

  useLayoutEffect(syncOverflow, [tabs]);

  useEffect(() => {
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the active tab in view when it changes (e.g. opening a repo far off
  // the right edge, or switching tabs by keyboard).
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeId]);

  return (
    <div className="tabs" role="tablist" aria-label="Open repositories">
      <div
        ref={stripRef}
        className={
          ['tab-strip', overflow.start ? 'fade-start' : '', overflow.end ? 'fade-end' : '']
            .filter(Boolean)
            .join(' ')
        }
        onScroll={syncOverflow}
        // Let a plain vertical wheel scroll the strip horizontally, so a
        // trackpad/mouse without horizontal scroll can still reach every tab.
        onWheel={(event) => {
          if (event.deltaX !== 0) return;
          stripRef.current?.scrollBy({ left: event.deltaY });
        }}
      >
        {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          className={
            [
              tab.id === activeId ? 'tab active' : 'tab',
              tab.id === dragId ? 'dragging' : '',
              dropIndex === index ? 'drop-before' : '',
              dropIndex === tabs.length && index === tabs.length - 1 ? 'drop-after' : '',
            ]
              .filter(Boolean)
              .join(' ')
          }
          draggable
          // The repo path shows via the global design tooltip (portaled to body,
          // so it isn't clipped by the frameless titlebar); empty tabs get none.
          data-tooltip={tab.repoPath}
          onClick={() => onSelect(tab.id)}
          onDragStart={(event) => {
            setDragId(tab.id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(event) => {
            if (!dragId || dragId === tab.id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            // Drop after the tab when past its midpoint, otherwise before it.
            const rect = event.currentTarget.getBoundingClientRect();
            const after = event.clientX > rect.left + rect.width / 2;
            setDropIndex(after ? index + 1 : index);
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragId && dropIndex !== null) onReorder(dragId, dropIndex);
            endDrag();
          }}
          onDragEnd={endDrag}
        >
          {tab.repoPath && (
            <span
              className="tab-icon"
              aria-hidden="true"
              data-tooltip={tab.isWorktree ? 'Worktree' : undefined}
            >
              {tab.isWorktree ? <WorktreeIcon size={14} /> : <BranchIcon size={14} />}
            </span>
          )}
          <span className="tab-title">{tab.title}</span>
          {(tabs.length > 1 || tab.repoPath) && (
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${tab.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              <CloseIcon size={12} />
            </button>
          )}
        </div>
        ))}
      </div>
      <div
          className="tabs-action">
        <button
          type="button"
          className="tab-add tooltip-host"
          aria-label="New tab"
          data-tooltip="New tab"
          onClick={onAdd}
        >
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}
