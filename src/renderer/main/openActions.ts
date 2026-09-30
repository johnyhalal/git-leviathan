import { useEffect, useState } from 'react';
import type {
  DiffSource,
  ExternalMergeResult,
  ExternalToolsState,
  OpenResult,
  OpenToolsState,
} from '../../types/ipc';

/**
 * "Open in editor / terminal / file manager" for any repo folder or file in it.
 * Every call site (file menus, the diff header, the toolbar, sidebar menus, the
 * command palette) goes through here, so they share one error path — a toast
 * raised by the handler App installs — and one cached view of the user's tools.
 */

let tools: OpenToolsState | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

type ReportHandler = (title: string, message: string, variant?: 'error' | 'info') => void;

let reportError: ReportHandler = (title, message) => console.warn(title, message);

/** Route open failures (and merge-tool notices) somewhere visible (App points this at its toast stack). */
export function setOpenErrorHandler(handler: ReportHandler): void {
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

let externalTools: ExternalToolsState | null = null;
let externalLoading: Promise<void> | null = null;
const externalListeners = new Set<() => void>();

/** Swap in fresh external diff/merge tool state (after a Settings change). */
export function setExternalTools(next: ExternalToolsState): void {
  externalTools = next;
  for (const listener of externalListeners) listener();
}

/** The external diff/merge tools found and the user's picks; null until first loaded. */
export function useExternalTools(): ExternalToolsState | null {
  const [state, setState] = useState(externalTools);
  useEffect(() => {
    const listener = () => setState(externalTools);
    externalListeners.add(listener);
    if (!externalTools && !externalLoading) {
      externalLoading = window.api.open.externalTools().then(setExternalTools);
    }
    listener();
    return () => {
      externalListeners.delete(listener);
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

export const openExternalDiff = (repoPath: string, source: DiffSource, file: string) =>
  report('Couldn’t open the diff tool', window.api.open.externalDiff(repoPath, source, file));

/**
 * Resolve a conflicted file in the external merge tool. Resolves when the tool
 * closes (or `cancelExternalMerge` stops the wait), with the merge state after
 * it; anything short of resolved is also toasted. `announce` toasts how to
 * finish there as it opens, for call sites with no waiting state of their own.
 */
export async function openExternalMerge(
  repoPath: string,
  file: string,
  toolName: string,
  opts?: { announce?: string },
): Promise<ExternalMergeResult> {
  if (opts?.announce) reportError(`Opened ${file} in ${toolName}`, opts.announce, 'info');
  const outcome = await window.api.open.externalMerge(repoPath, file);
  const { result } = outcome;
  if (result.status === 'error') {
    reportError('Merge tool didn’t resolve the file', result.message);
  } else if (result.status === 'unchanged') {
    reportError(
      `${file} is still conflicted`,
      `${toolName} closed without saving the merge to the file.`,
      'info',
    );
  } else if (result.status === 'unresolved') {
    reportError(
      `${file} is still conflicted`,
      `The merge saved from ${toolName} still has conflict markers. It’s kept on disk; finish it here or in ${toolName}.`,
      'info',
    );
  }
  return outcome;
}

/** Stop waiting for the merge tool open in `repoPath`; the file stays as last saved, still conflicted. */
export const cancelExternalMerge = (repoPath: string) => window.api.open.cancelExternalMerge(repoPath);

/** The label for "show this change in the external diff tool". */
export const externalDiffLabel = (toolName: string) => `Open Diff in ${toolName}`;

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
