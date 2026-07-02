import { ThemeSwitch } from '../../ThemeSwitch';
import { SettingsSection } from '../SettingsSection';
import { SettingsRow } from '../SettingsRow';

/** Appearance settings — theme for now. */
export function AppearancePanel() {
  return (
    <SettingsSection title="Appearance">
      <SettingsRow
        label="Theme"
        description="Follow the system or force light or dark."
      >
        <ThemeSwitch />
      </SettingsRow>
    </SettingsSection>
  );
}
