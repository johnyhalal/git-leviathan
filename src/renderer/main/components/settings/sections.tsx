import type { ComponentType } from 'react';
import { GeneralPanel } from './panels/GeneralPanel';
import { AppearancePanel } from './panels/AppearancePanel';
import { IntegrationsPanel } from './panels/IntegrationsPanel';

/** One category in the settings sidebar. Its `Panel` renders in the content pane. */
export interface SettingsSectionDef {
  id: string;
  label: string;
  Panel: ComponentType;
}

/**
 * Single source of truth for the settings groups: drives both the sidebar rail
 * and the content pane. Adding a group is one entry here plus its panel component.
 */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { id: 'general', label: 'General', Panel: GeneralPanel },
  { id: 'appearance', label: 'Appearance', Panel: AppearancePanel },
  { id: 'integrations', label: 'Integrations', Panel: IntegrationsPanel },
];
