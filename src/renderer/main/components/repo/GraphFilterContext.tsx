import { createContext, useContext } from 'react';
import type { GraphFilter } from '../../../../types/ipc';
import type { BranchMenuTarget } from './BranchContextMenu';

/**
 * The repo's graph filter plus the ways to change it, provided by RepoView so
 * the sidebar rows, both branch menus and the graph's filter bar share one
 * source of truth without threading props through every layer.
 */
export interface GraphFilterControls {
  filter: GraphFilter;
  /**
   * Show or hide branches in the graph. Outside solo mode this edits the hidden
   * list; while soloing it adds to / removes from the solo set, so "visible"
   * always means "drawn in the graph".
   */
  setVisible: (refs: string[], visible: boolean) => void;
  /** Show only these branches (replacing any solo set), or `null` to stop soloing. */
  solo: (refs: string[] | null) => void;
  /** Show every branch again. */
  clear: () => void;
}

export const GraphFilterContext = createContext<GraphFilterControls | null>(null);

/** The graph filter controls, or null outside a repo view. */
export function useGraphFilter(): GraphFilterControls | null {
  return useContext(GraphFilterContext);
}

export const localRef = (name: string) => `refs/heads/${name}`;
export const remoteRef = (remote: string, name: string) => `refs/remotes/${remote}/${name}`;

/** The full refs a branch menu target stands for (its local and/or remote branch). */
export function targetRefs(target: BranchMenuTarget): string[] {
  const refs: string[] = [];
  if (target.local) refs.push(localRef(target.name));
  if (target.remote && target.remoteName) refs.push(remoteRef(target.remoteName, target.name));
  return refs;
}

/** Whether `ref` is drawn in the graph under `filter`. */
export function isRefVisible(filter: GraphFilter, ref: string): boolean {
  return filter.solo.length ? filter.solo.includes(ref) : !filter.hidden.includes(ref);
}

/** Whether the filter narrows the graph at all. */
export function isGraphFiltered(filter: GraphFilter): boolean {
  return filter.solo.length > 0 || filter.hidden.length > 0;
}
