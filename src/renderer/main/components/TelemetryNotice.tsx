import { useEffect } from 'react';

interface TelemetryNoticeProps {
  /** "OK": dismiss and mark the notice acknowledged. */
  onAcknowledge: () => void;
  /** "Open Settings": acknowledge, then jump to Settings → General. */
  onOpenSettings: () => void;
}

/**
 * One-time, centered notice telling the user anonymous usage analytics is on
 * and can be turned off. Deliberately has no corner close button — the only way
 * out is one of the two footer buttons, and both acknowledge the notice so it
 * never reappears. Reuses the shared `.settings-overlay` popup shell (which
 * centers its content) per the app's popup convention.
 */
export function TelemetryNotice({ onAcknowledge, onOpenSettings }: TelemetryNoticeProps) {
  // Escape is treated as "OK" so keyboard users aren't trapped by the missing
  // close button; it still acknowledges the notice.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onAcknowledge();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onAcknowledge]);

  return (
    // No backdrop click-to-close: an explicit button press is required.
    <div className="settings-overlay">
      <div
        className="settings-panel telemetry-notice-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="telemetry-notice-title"
      >
        <div className="telemetry-notice-body">
          <h2 id="telemetry-notice-title" className="telemetry-notice-title">
            Anonymous usage analytics
          </h2>
          <p className="telemetry-notice-text">
            GitLeviathan sends anonymous usage data — such as app opens, commits,
            and update checks — to help improve the app. No repository contents or
            personal data are collected. You can turn this off any time in
            Settings → General.
          </p>
          <div className="telemetry-notice-actions">
            <button
              type="button"
              className="telemetry-notice-ok"
              onClick={onAcknowledge}
            >
              OK
            </button>
            <button
              type="button"
              className="telemetry-notice-settings"
              onClick={onOpenSettings}
            >
              Open Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
