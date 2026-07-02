import { useEffect } from 'react';
import { ThemeSwitch } from './ThemeSwitch';
import { CloseIcon } from '../assets/icons';

interface SettingsProps {
  onClose: () => void;
}

/** Modal settings dialog. Holds the theme selector for now. */
export function Settings({ onClose }: SettingsProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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

        <div className="settings-row">
          <span className="settings-label">Theme</span>
          <ThemeSwitch />
        </div>
      </div>
    </div>
  );
}
