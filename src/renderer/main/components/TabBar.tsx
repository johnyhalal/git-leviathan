import { useState } from 'react';
import { BranchIcon, CloseIcon, FolderIcon, PlusIcon } from '../../../../assets/icons';

export interface Tab {
  id: string;
  /** Repository name shown on the tab. */
  title: string;
  /** Absolute path of the open repository, or undefined for an empty tab. */
  repoPath?: string;
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
  // Hovered tab's path + anchor rect for the custom tooltip. Electron's native
  // `title` tooltip is unreliable in the frameless titlebar region, so we draw
  // our own.
  const [hover, setHover] = useState<{ path: string; left: number; top: number } | null>(null);

  const endDrag = () => {
    setDragId(null);
    setDropIndex(null);
  };

  return (
    <div className="tabs" role="tablist" aria-label="Open repositories">
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
          onClick={() => onSelect(tab.id)}
          onMouseEnter={(event) => {
            if (!tab.repoPath) return;
            const rect = event.currentTarget.getBoundingClientRect();
            setHover({ path: tab.repoPath, left: rect.left, top: rect.bottom + 4 });
          }}
          onMouseLeave={() => setHover(null)}
          onDragStart={(event) => {
            setHover(null);
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
            <span className="tab-icon" aria-hidden="true">
              <BranchIcon size={14} />
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
      <button
        type="button"
        className="tab-add"
        aria-label="New tab"
        title="New tab"
        onClick={onAdd}
      >
        <PlusIcon />
      </button>
      {hover && (
        <div className="tab-tooltip" style={{ left: hover.left, top: hover.top }}>
          <FolderIcon size={13} />
          <span>{hover.path}</span>
        </div>
      )}
    </div>
  );
}
