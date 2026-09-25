import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  APP_COMMANDS,
  APP_COMMAND_IDS,
  type AppCommandId,
  type AppCommandSpec,
} from '../../../types/ipc';
import { formatAccelerator, matchAccelerator } from './keys';

/** A command a component offers to the menu, the palette and the keyboard. */
export interface Command {
  /** An `AppCommandId` from the shared table, or any unique id for a dynamic entry. */
  id: string;
  /** Defaults to the table's label. */
  label?: string;
  /** Defaults to the table's category. */
  category?: string;
  run: () => void;
  /** Whether it can run now (default true). Disabled commands are hidden and greyed. */
  enabled?: boolean;
  /** In-page shortcuts for a dynamic entry (a table command takes its keys from the table). */
  accelerators?: string[];
  /** Whether its shortcut fires while typing in a text field (default true). */
  allowInEditable?: boolean;
}

/** A registered command as the palette lists it. */
export interface ResolvedCommand {
  id: string;
  label: string;
  category: string;
  /** The formatted primary shortcut, or '' when it has none. */
  shortcut: string;
  run: () => void;
}

interface Registry {
  register(layer: string, commands: Command[]): void;
  unregister(layer: string): void;
  run(id: string): boolean;
  list(): ResolvedCommand[];
  subscribe(listener: () => void): () => void;
}

const CommandContext = createContext<Registry | null>(null);

const specById = new Map<string, AppCommandSpec>(APP_COMMANDS.map((spec) => [spec.id, spec]));

/** The palette may toggle itself shut over its own dialog; nothing else runs under one. */
const DIALOG_EXEMPT = new Set<string>(['palette']);

const dialogOpen = () =>
  document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;

const isEditable = (node: EventTarget | null) => {
  const el = node as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
};

/** The keys the page itself listens for: aliases always, the primary only off-menu. */
function pageAccelerators(command: Command): string[] {
  const spec = specById.get(command.id);
  if (!spec) return command.accelerators ?? [];
  return [...(!spec.menu && spec.accelerator ? [spec.accelerator] : []), ...(spec.aliases ?? [])];
}

/** Everything registered, the most recently registered layer winning an id. */
function effective(layers: Map<string, Command[]>): Map<string, Command> {
  const byId = new Map<string, Command>();
  for (const commands of layers.values()) {
    for (const command of commands) byId.set(command.id, command);
  }
  return byId;
}

/**
 * Owns every registered command and the three ways to trigger one: native menu
 * picks (forwarded from the main process by id), one page-wide keydown listener
 * for the shortcuts the menu doesn't carry, and the command palette. It also
 * reports which commands can run so the menu greys out the rest.
 */
export function CommandProvider({ children }: { children: ReactNode }) {
  const layers = useRef(new Map<string, Command[]>());
  const listeners = useRef(new Set<() => void>());
  // Bumped when the set of commands (ids, labels, enabled) changes — not on every
  // re-registration, since `run` closures change identity on each render.
  const [version, setVersion] = useState(0);
  const signature = useRef('');

  const registry = useMemo<Registry>(() => {
    const changed = () => {
      const next = [...effective(layers.current).values()]
        .map((c) => `${c.id}\u0000${c.label ?? ''}\u0000${c.enabled === false ? 0 : 1}`)
        .join('\u0001');
      if (next === signature.current) return;
      signature.current = next;
      setVersion((v) => v + 1);
      for (const listener of listeners.current) listener();
    };
    return {
      register(layer, commands) {
        layers.current.set(layer, commands);
        changed();
      },
      unregister(layer) {
        layers.current.delete(layer);
        changed();
      },
      run(id) {
        const command = effective(layers.current).get(id);
        if (!command || command.enabled === false) return false;
        if (!DIALOG_EXEMPT.has(id) && dialogOpen()) return false;
        command.run();
        return true;
      },
      list() {
        return [...effective(layers.current).values()]
          .filter((command) => command.enabled !== false)
          .map((command) => {
            const spec = specById.get(command.id);
            const primary = spec?.accelerator ?? command.accelerators?.[0];
            return {
              id: command.id,
              label: command.label ?? spec?.label ?? command.id,
              category: command.category ?? spec?.category ?? 'App',
              shortcut: primary ? formatAccelerator(primary) : '',
              run: command.run,
            };
          });
      },
      subscribe(listener) {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    };
  }, []);

  // Native menu picks and their accelerators arrive here by id.
  useEffect(() => window.api.menu.onCommand((id) => void registry.run(id)), [registry]);

  // The one page-wide listener for shortcuts the native menu doesn't own.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      for (const command of effective(layers.current).values()) {
        if (!pageAccelerators(command).some((accel) => matchAccelerator(accel, event))) continue;
        if (command.allowInEditable === false && isEditable(event.target)) return;
        event.preventDefault();
        if (!event.repeat) registry.run(command.id);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [registry]);

  // Tell the main process which menu commands can run, so it greys out the rest.
  useEffect(() => {
    const ids = [...effective(layers.current).values()]
      .filter((command) => command.enabled !== false && APP_COMMAND_IDS.has(command.id))
      .map((command) => command.id as AppCommandId);
    window.api.menu.setEnabled(ids);
  }, [version]);

  return <CommandContext.Provider value={registry}>{children}</CommandContext.Provider>;
}

function useRegistry(): Registry {
  const registry = useContext(CommandContext);
  if (!registry) throw new Error('useCommands must be used inside a CommandProvider');
  return registry;
}

/**
 * Offer `commands` for as long as the calling component is mounted. Pass a fresh
 * array each render — the registry only re-announces when ids, labels or
 * enabled states actually change, and always runs the latest closures.
 */
export function useCommands(commands: Command[]): void {
  const registry = useRegistry();
  const layer = useId();
  useLayoutEffect(() => {
    registry.register(layer, commands);
  });
  useEffect(() => () => registry.unregister(layer), [registry, layer]);
}

/** The enabled commands, re-read whenever the registered set changes. */
export function useCommandList(): ResolvedCommand[] {
  const registry = useRegistry();
  const [list, setList] = useState(() => registry.list());
  useEffect(() => {
    setList(registry.list());
    return registry.subscribe(() => setList(registry.list()));
  }, [registry]);
  return list;
}

/** Run a registered command by id, from outside the menu and keyboard. */
export function useRunCommand(): (id: string) => boolean {
  const registry = useRegistry();
  return useCallback((id: string) => registry.run(id), [registry]);
}
