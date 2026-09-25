import { APP_COMMANDS, type AppCommandId } from '../../../types/ipc';

const isMac = () => window.api.platform === 'darwin';

interface ParsedAccelerator {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/** Split an Electron accelerator (`CmdOrCtrl+Shift+P`) into modifiers + key. */
function parse(accelerator: string): ParsedAccelerator {
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((part) => part.toLowerCase()));
  const cmdOrCtrl = mods.has('cmdorctrl') || mods.has('commandorcontrol');
  return {
    ctrl: mods.has('ctrl') || mods.has('control') || (cmdOrCtrl && !isMac()),
    meta: mods.has('cmd') || mods.has('command') || (cmdOrCtrl && isMac()),
    shift: mods.has('shift'),
    alt: mods.has('alt') || mods.has('option'),
    key,
  };
}

// Punctuation whose `event.key` changes under Shift, matched by physical key.
const CODE_FOR_KEY: Record<string, string> = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ',': 'Comma',
};

/** Whether a keydown is exactly this accelerator (no extra modifiers held). */
export function matchAccelerator(accelerator: string, event: KeyboardEvent): boolean {
  const want = parse(accelerator);
  if (
    event.ctrlKey !== want.ctrl ||
    event.metaKey !== want.meta ||
    event.shiftKey !== want.shift ||
    event.altKey !== want.alt
  ) {
    return false;
  }
  const code = CODE_FOR_KEY[want.key];
  if (code) return event.code === code;
  // Letters and digits go by the typed character (as the native menu does), so
  // ⌘Z stays on the key labelled Z on a QWERTZ layout.
  return event.key.toLowerCase() === want.key.toLowerCase();
}

const MAC_SYMBOLS: Record<string, string> = { Tab: '⇥', Enter: '↩' };

/** A shortcut as the user sees it: `⌘⇧P` on macOS, `Ctrl+Shift+P` elsewhere. */
export function formatAccelerator(accelerator: string): string {
  const { ctrl, meta, shift, alt, key } = parse(accelerator);
  const label = key.length === 1 ? key.toUpperCase() : key;
  if (isMac()) {
    return `${ctrl ? '⌃' : ''}${alt ? '⌥' : ''}${shift ? '⇧' : ''}${meta ? '⌘' : ''}${
      MAC_SYMBOLS[label] ?? label
    }`;
  }
  return [ctrl && 'Ctrl', alt && 'Alt', shift && 'Shift', meta && 'Win', label]
    .filter(Boolean)
    .join('+');
}

/** The formatted primary shortcut of an app command, or '' when it has none. */
export function shortcutFor(id: AppCommandId): string {
  const accelerator = APP_COMMANDS.find((spec) => spec.id === id)?.accelerator;
  return accelerator ? formatAccelerator(accelerator) : '';
}

/** `label (⌘⇧P)` for a tooltip, or just `label` when the command has no key. */
export function withShortcut(label: string, id: AppCommandId): string {
  const key = shortcutFor(id);
  return key ? `${label} (${key})` : label;
}
