import type { ReactNode } from 'react';

interface SettingsRowProps {
  label: string;
  description?: string;
  children: ReactNode;
}

/** A single labelled setting: text on the left, its control on the right. */
export function SettingsRow({ label, description, children }: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-label">{label}</span>
        {description && <span className="settings-desc">{description}</span>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}
