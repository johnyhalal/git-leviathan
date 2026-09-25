import { useEffect, useState } from 'react';
import type { OpenResult, OpenToolsState } from '../../types/ipc';

/**
 * "Open in editor / terminal / file manager" for any repo folder or file in it.
 * Every call site (file menus, the diff header, the toolbar, sidebar menus, the
 * command palette) goes through here, so they share one error path — a toast
 * raised by the handler App installs — and one cached view of the user's tools.
 */

let tools: OpenToolsState | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

let reportError: (title: string, message: string) => void = (title, message) =>
  console.warn(title, message);

/** Route open failures somewhere visible (App points this at its toast stack). */
export function setOpenErrorHandler(handler: (title: string, message: string) => void): void {
  reportError = handler;
}

/** Swap in fresh tool state (after a Settings change) and notify subscribers. */
export function setOpenTools(next: OpenToolsState): void {
  tools = next;
  for (const listener of listeners) listener();
}

/** The installed editors/terminals and the user's choices; null until first loaded. */
export function useOpenTools(): OpenToolsState | null {
  const [state, setState] = useState(tools);
  useEffect(() => {
    const listener = () => setState(tools);
    listeners.add(listener);
    if (!tools && !loading) {
      loading = window.api.open.tools().then(setOpenTools);
    }
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}

/** The file manager's name as each platform words the action. */
export function revealLabel(): string {
  if (window.api.platform === 'darwin') return 'Reveal in Finder';
  if (window.api.platform === 'win32') return 'Show in Explorer';
  return 'Show in Folder';
}

async function report(title: string, pending: Promise<OpenResult>): Promise<void> {
  const result = await pending;
  if (result.status === 'error') reportError(title, result.message);
}

export const openInEditor = (repoPath: string, relPath?: string) =>
  report('Couldn’t open in editor', window.api.open.inEditor(repoPath, relPath));

export const openInTerminal = (repoPath: string) =>
  report('Couldn’t open a terminal', window.api.open.inTerminal(repoPath));

export const revealInFileManager = (repoPath: string, relPath?: string) =>
  report(`Couldn’t ${revealLabel().toLowerCase()}`, window.api.open.reveal(repoPath, relPath));

export const openWithDefaultApp = (repoPath: string, relPath: string) =>
  report('Couldn’t open the file', window.api.open.withDefaultApp(repoPath, relPath));

/**
 * Context-menu rows for opening `relPath` in `repoPath` (or the folder itself
 * when `relPath` is omitted): the chosen editor, the default app (files only),
 * a terminal (folders only) and the file manager.
 */
export function openMenuItems(
  editorName: string | undefined,
  repoPath: string,
  relPath?: string,
): { label: string; onClick: () => void }[] {
  return [
    {
      label: editorName ? `Open in ${editorName}` : 'Open in Editor',
      onClick: () => void openInEditor(repoPath, relPath),
    },
    ...(relPath
      ? [{ label: 'Open with Default App', onClick: () => void openWithDefaultApp(repoPath, relPath) }]
      : [{ label: 'Open in Terminal', onClick: () => void openInTerminal(repoPath) }]),
    { label: revealLabel(), onClick: () => void revealInFileManager(repoPath, relPath) },
  ];
}
