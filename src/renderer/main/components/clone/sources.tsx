import type { IntegrationProvider } from '../../../../types/ipc';

/** Everything needed to start a clone, regardless of source. */
export interface CloneParams {
  /** Repository URL (HTTPS or SSH). */
  url: string;
  /** Absolute path of the folder to clone into. */
  destination: string;
  /** Name of the subfolder to create inside `destination`. */
  directory: string;
}

/** Folder name a clone would land in by default, derived from the repo URL. */
export function repoNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  // Handles both "https://host/owner/repo" and scp-like "git@host:owner/repo".
  const segment = cleaned.split(/[/:]/).pop() ?? '';
  return segment || '';
}

/**
 * One entry in the clone dialog's sidebar. `kind` decides the middle input the
 * dialog renders — a URL field (`url`) or the provider repo picker (`repo`).
 */
export interface CloneSourceDef {
  id: string;
  label: string;
  kind: 'url' | 'repo';
  /** Present for `repo` sources: which host to browse. */
  provider?: IntegrationProvider;
}

/**
 * Single source of truth for the clone dialog's sources: drives both the
 * sidebar rail and which middle input renders. The dialog owns the shared
 * destination and Clone button around it.
 */
export const CLONE_SOURCES: CloneSourceDef[] = [
  { id: 'url', label: 'Clone with URL', kind: 'url' },
  { id: 'github', label: 'GitHub', kind: 'repo', provider: 'github' },
  { id: 'gitlab', label: 'GitLab', kind: 'repo', provider: 'gitlab' },
];
