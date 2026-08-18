import { useEffect, useState } from 'react';
import { CloseIcon } from '../../../../assets/icons';
import { SETTINGS_SECTIONS } from './settings/sections';

interface SettingsProps {
  onClose: () => void;
  /** Section to open on mount; defaults to the first (General). */
  initialSection?: string;
}

/** Modal settings dialog: a category rail on the left, the active panel on the right. */
export function Settings({ onClose, initialSection }: SettingsProps) {
  // An explicit `initialSection` (a deep-link, e.g. "open to Integrations") wins;
  // otherwise we restore the last-opened section from settings.json on mount.
  const requested = SETTINGS_SECTIONS.find((s) => s.id === initialSection)?.id;
  const [activeId, setActiveId] = useState(requested ?? SETTINGS_SECTIONS[0].id);

  // Persist so the next open remembers where the user was.
  const selectSection = (id: string) => {
    setActiveId(id);
    void window.api.app.setSettingsSection(id);
  };

  useEffect(() => {
    let alive = true;
    if (requested) {
      // A deep-linked section also becomes the remembered one.
      void window.api.app.setSettingsSection(requested);
    } else {
      void window.api.app.getSettingsSection().then((id) => {
        if (alive && SETTINGS_SECTIONS.some((s) => s.id === id)) setActiveId(id);
      });
    }
    return () => {
      alive = false;
    };
    // Mount-only: `requested` is fixed for the modal's lifetime.
  }, []);

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
                onClick={() => selectSection(section.id)}
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
