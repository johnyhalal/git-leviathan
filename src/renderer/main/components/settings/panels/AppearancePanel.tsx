import { useState } from 'react';
import type { DateFormat } from '../../../../../types/ipc';
import { ThemeSwitch } from '../../ThemeSwitch';
import { SettingsSection } from '../SettingsSection';
import { SettingsRow } from '../SettingsRow';
import { formatDateTime, setDateFormat, useDateFormat } from '../../../dateFormat';

/** Labels for each date format, in dropdown order; the example is appended live. */
const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'iso', label: 'ISO 8601' },
  { value: 'us', label: 'US' },
  { value: 'eu', label: 'European' },
  { value: 'relative', label: 'Relative' },
];

/** Appearance settings — theme and how dates are shown. */
export function AppearancePanel() {
  const dateFormat = useDateFormat();
  // A fixed sample moment for the dropdown's examples, so they don't shift
  // while the panel is open.
  const [sample] = useState(() => new Date().toISOString());

  return (
    <SettingsSection title="Appearance">
      <SettingsRow
        label="Theme"
        description="Follow the system or force light or dark."
      >
        <ThemeSwitch />
      </SettingsRow>
      <SettingsRow
        label="Date format"
        description="How commit, blame, and pull request dates are shown."
      >
        <select
          className="form-input"
          value={dateFormat}
          onChange={(e) => setDateFormat(e.target.value as DateFormat)}
        >
          {DATE_FORMAT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label} — {opt.value === 'relative'
                ? '3 days ago'
                : formatDateTime(sample, opt.value)}
            </option>
          ))}
        </select>
      </SettingsRow>
    </SettingsSection>
  );
}
