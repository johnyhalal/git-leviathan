import { useMemo } from 'react';
import type { RepoRefs } from '../../../../types/ipc';
import { EyeOffIcon } from '../../../../../assets/icons';
import { localRef, remoteRef, useGraphFilter } from './GraphFilterContext';

/** A full branch ref as the sidebar shows it: `main`, `origin/main`. */
const shortRef = (ref: string) => ref.replace(/^refs\/(heads|remotes)\//, '');

/** Names listed before collapsing the rest into "+N more". */
const MAX_NAMED = 2;

/**
 * A strip above the commit graph while it's filtered, saying what's left out and
 * offering "Show all", so a hidden branch is never silently missing. Renders
 * nothing when the graph shows every branch.
 */
export function GraphFilterBar({ refs }: { refs: RepoRefs | null }) {
  const graph = useGraphFilter();

  // Branches that still exist: a filter can outlive a deleted branch, which
  // shouldn't count as "hidden".
  const existing = useMemo(
    () =>
      new Set([
        ...(refs?.localBranches ?? []).map((branch) => localRef(branch.name)),
        ...(refs?.remoteBranches ?? []).map((branch) => remoteRef(branch.remote, branch.name)),
      ]),
    [refs],
  );

  if (!graph || !refs) return null;
  const { filter } = graph;

  let message: string;
  let tooltip: string;
  if (filter.solo.length) {
    const names = filter.solo.map(shortRef);
    const rest = names.length - MAX_NAMED;
    message = `Showing only ${names.slice(0, MAX_NAMED).join(', ')}${rest > 0 ? ` +${rest} more` : ''}`;
    tooltip = `${names.join(', ')} (and the checked-out branch)`;
  } else {
    const hidden = filter.hidden.filter((ref) => existing.has(ref));
    if (hidden.length === 0) return null;
    message = `${hidden.length} branch${hidden.length === 1 ? '' : 'es'} hidden from the graph`;
    tooltip = hidden.map(shortRef).join(', ');
  }

  return (
    <div className="graph-filter-bar" role="status">
      <EyeOffIcon size={14} />
      <span className="graph-filter-bar-text tooltip-host" data-tooltip={tooltip}>
        {message}
      </span>
      <button type="button" className="graph-filter-bar-clear" onClick={graph.clear}>
        Show all
      </button>
    </div>
  );
}
