import { CloseIcon, PlusIcon } from '../../../../assets/icons';

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
}

/** Left-aligned repository tabs in the top bar. */
export function TabBar({ tabs, activeId, onSelect, onClose, onAdd }: TabBarProps) {
  return (
    <div className="tabs" role="tablist" aria-label="Open repositories">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          className={tab.id === activeId ? 'tab active' : 'tab'}
          onClick={() => onSelect(tab.id)}
        >
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
    </div>
  );
}
