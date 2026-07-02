import { useEffect, useState } from 'react';
import { CloseIcon } from '../../../../assets/icons';
import { SETTINGS_SECTIONS } from './settings/sections';

interface SettingsProps {
  onClose: () => void;
}

/** Modal settings dialog: a category rail on the left, the active panel on the right. */
export function Settings({ onClose }: SettingsProps) {
  const [activeId, setActiveId] = useState(SETTINGS_SECTIONS[0].id);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const active =
    SETTINGS_SECTIONS.find((section) => section.id === activeId) ??
    SETTINGS_SECTIONS[0];
  const ActivePanel = active.Panel;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>Settings</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="settings-body">
          <nav
            className="settings-nav"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Settings categories"
          >
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={section.id === activeId}
                className={section.id === activeId ? 'active' : undefined}
                onClick={() => setActiveId(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>

          <div
            className="settings-content"
            role="tabpanel"
            aria-label={active.label}
          >
            <ActivePanel />
          </div>
        </div>
      </div>
    </div>
  );
}
