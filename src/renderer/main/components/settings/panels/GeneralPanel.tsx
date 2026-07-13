import { useEffect, useState } from 'react';
import {
  DEFAULT_UPDATE_CHECK_INTERVAL,
  type UpdateCheckInterval,
  type UpdateInfo,
} from '../../../../../types/ipc';
import { SettingsSection } from '../SettingsSection';
import { SettingsRow } from '../SettingsRow';

/** Labels for each allowed update-check interval, in dropdown order. */
const INTERVAL_OPTIONS: { value: UpdateCheckInterval; label: string }[] = [
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Hourly' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Daily' },
  { value: 0, label: 'Never' },
];

/** Result of a manual "Check now": pending, or the outcome of the last check. */
type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; update: UpdateInfo };

/** General settings — the automatic update-check cadence + a manual check. */
export function GeneralPanel() {
  const [interval, setIntervalMin] = useState<UpdateCheckInterval>(
    DEFAULT_UPDATE_CHECK_INTERVAL,
  );
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });

  useEffect(() => {
    let alive = true;
    void window.api.app.getUpdateCheckInterval().then((minutes) => {
      if (alive) setIntervalMin(minutes);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onChange = (value: UpdateCheckInterval) => {
    setIntervalMin(value);
    void window.api.app.setUpdateCheckInterval(value);
  };

  const onCheckNow = () => {
    setCheck({ kind: 'checking' });
    void window.api.update.check().then((info) => {
      setCheck(info ? { kind: 'available', update: info } : { kind: 'up-to-date' });
    });
  };

  return (
    <SettingsSection title="General">
      <SettingsRow
        label="Check for updates"
        description="How often GitLeviathan looks for a newer release on GitHub."
      >
        <select
          className="settings-select"
          value={interval}
          onChange={(e) =>
            onChange(Number(e.target.value) as UpdateCheckInterval)
          }
        >
          {INTERVAL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow
        label="Updates"
        description={
          check.kind === 'up-to-date'
            ? "You're on the latest version."
            : check.kind === 'available'
              ? `Version ${check.update.version} is available.`
              : 'Look for a newer release right now.'
        }
      >
        {check.kind === 'available' ? (
          <button
            type="button"
            className="pill-btn pill-btn-green"
            onClick={() =>
              window.api.update.openRelease(check.update.releaseUrl)
            }
          >
            Get v{check.update.version}
          </button>
        ) : (
          <button
            type="button"
            className="pill-btn pill-btn-gray"
            onClick={onCheckNow}
            disabled={check.kind === 'checking'}
          >
            {check.kind === 'checking' ? 'Checking…' : 'Check now'}
          </button>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
