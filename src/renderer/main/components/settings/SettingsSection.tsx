import type { ReactNode } from 'react';

interface SettingsSectionProps {
  title?: string;
  children: ReactNode;
}

/** A titled group of settings rows within a panel. A panel may hold several. */
export function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <section className="settings-section">
      {title && <h3 className="settings-section-title">{title}</h3>}
      <div className="settings-group">{children}</div>
    </section>
  );
}
