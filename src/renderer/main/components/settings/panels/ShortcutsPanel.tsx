import { APP_COMMANDS, commandLabel, type AppCommandCategory } from '../../../../../types/ipc';
import { formatAccelerator } from '../../../commands/keys';
import { SettingsSection } from '../SettingsSection';
import { SettingsRow } from '../SettingsRow';

const CATEGORIES: AppCommandCategory[] = ['Repository', 'Tabs', 'App'];

/** Every keyboard shortcut, read from the shared command table. The set is fixed. */
export function ShortcutsPanel() {
  return (
    <div className="shortcuts-panel">
      {CATEGORIES.map((category) => (
        <SettingsSection key={category} title={category}>
          {APP_COMMANDS.filter((spec) => spec.category === category && spec.accelerator).map(
            (spec) => {
              const keys =
                spec.id === 'tab.goto'
                  ? [`${formatAccelerator('CmdOrCtrl+1')}–${formatAccelerator('CmdOrCtrl+9')}`]
                  : [spec.accelerator ?? '', ...(spec.aliases ?? [])].map(formatAccelerator);
              return (
                <SettingsRow key={spec.id} label={commandLabel(spec, window.api.platform).replace(/…$/, '')}>
                  <span className="shortcut-keys">
                    {keys.map((key) => (
                      <kbd key={key} className="shortcut-kbd">
                        {key}
                      </kbd>
                    ))}
                  </span>
                </SettingsRow>
              );
            },
          )}
          {category === 'Repository' && (
            <SettingsRow label="Commit" description="While typing the commit message.">
              <span className="shortcut-keys">
                <kbd className="shortcut-kbd">{formatAccelerator('CmdOrCtrl+Enter')}</kbd>
              </span>
            </SettingsRow>
          )}
        </SettingsSection>
      ))}
    </div>
  );
}
