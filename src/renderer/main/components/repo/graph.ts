// Commit-graph layout: turns a linear, topo-ordered commit list (each with its
// parent hashes) into per-row descriptors the CommitGraph cell can draw.

/**
 * Palette for graph lanes: 10 colors ramping green → blue, cycled by lane so a
 * repo with more than 10 concurrent lanes wraps back to the start.
 */
export const GRAPH_COLORS = [
  '#43d7c7',
  '#435bd7',
  '#6d43d7',
  '#9843d7',
  '#d143d7',
  '#d74352',
  '#d77643',
  '#d7bc43',
  '#bcd743',
  '#55d743',
] as const;

export const laneColor = (lane: number) => lane % GRAPH_COLORS.length;

/** A branch line that passes straight through a row. */
export interface GraphLane {
  lane: number;
  /** Index into {@link GRAPH_COLORS}. */
  color: number;
  /** Drawn dotted — a stash's line reaching down to its base commit. */
  dashed?: boolean;
}

/** A quarter-curve connecting a row's node to a neighbouring lane. */
export interface GraphCurve {
  lane: number;
  /** Index into {@link GRAPH_COLORS}. */
  color: number;
  /** Drawn dotted — a stash's line reaching down to its base commit. */
  dashed?: boolean;
}

/** Everything needed to draw one graph cell. */
export interface GraphNode {
  /** Lane the commit dot sits on. */
  node: number;
  /** Palette index for the dot and its own lane line. */
  color: number;
  /** Lanes drawn as full-height vertical lines through this row. */
  verticals?: GraphLane[];
  /** Curves entering the node from a lane at the top edge (branches merging in). */
  in?: GraphCurve[];
  /** Curves leaving the node toward a lane at the bottom edge (branches forking off). */
  out?: GraphCurve[];
  /** Suppress the node's own top-half line (branch tip / newest). */
  endTop?: boolean;
  /** Suppress the node's own bottom-half line (root / oldest). */
  endBottom?: boolean;
  /** This row is a stash: hollow node, and its line to the base is dotted. */
  dashed?: boolean;
  /** This row stands in for the working tree: empty, dotted-ring node. */
  working?: boolean;
}

interface GraphInput {
  hash: string;
  parents: string[];
  /** Present when the row is a stash (see {@link GraphNode.dashed}). */
  stashIndex?: number;
  /** Present when the row is the synthetic working-tree row. */
  working?: boolean;
}

/**
 * Assign each commit a lane and the edges connecting it to the rows above and
 * below. Commits must be in display order (newest first) with children before
 * parents (git's --topo-order). Lanes are not compacted, so pass-through branch
 * lines stay vertical; a lane simply stays open until its commit is reached.
 */
export function computeGraph(commits: GraphInput[]): GraphNode[] {
  // lanes[i] = the hash lane i is currently routing toward, or null if free.
  const lanes: (string | null)[] = [];
  // laneDashed[i] tracks whether lane i belongs to a stash, so its pass-through
  // and merge-in segments are drawn dotted all the way down to the base commit.
  const laneDashed: boolean[] = [];
  const firstFree = () => {
    const free = lanes.indexOf(null);
    return free === -1 ? lanes.length : free;
  };
  const freeLane = (i: number) => {
    lanes[i] = null;
    laneDashed[i] = false;
  };

  return commits.map((commit) => {
    const isStash = commit.stashIndex !== undefined;
    const incoming: number[] = [];
    lanes.forEach((waiting, i) => {
      if (waiting === commit.hash) incoming.push(i);
    });

    const isTip = incoming.length === 0;
    // Prefer a solid incoming lane for the node so a dotted stash lane stays the
    // one that curves in, rather than becoming the node's own (solid) line.
    const nodeLane = isTip
      ? firstFree()
      : incoming.find((lane) => !laneDashed[lane]) ?? incoming[0];

    // Snapshot the lanes entering this row from above.
    const topLanes = lanes.slice();
    const topDashed = laneDashed.slice();

    // Lanes that were waiting for this commit (other than the node's) merge in.
    for (const lane of incoming) if (lane !== nodeLane) freeLane(lane);

    const out: GraphCurve[] = [];
    if (commit.parents.length === 0) {
      // Root commit (or a stash whose base fell outside the page): lane ends here.
      freeLane(nodeLane);
    } else {
      // First parent continues straight down the node's lane; a stash marks that
      // lane dotted, a real commit resets it (lanes get reused).
      lanes[nodeLane] = commit.parents[0];
      laneDashed[nodeLane] = isStash;
      // Extra parents (a merge) fork off to their own / an existing lane.
      for (let k = 1; k < commit.parents.length; k++) {
        const parent = commit.parents[k];
        let lane = lanes.indexOf(parent);
        if (lane === -1) {
          lane = firstFree();
          lanes[lane] = parent;
          laneDashed[lane] = false;
        }
        out.push({ lane, color: laneColor(lane) });
      }
    }

    const verticals: GraphLane[] = [];
    const inbound: GraphCurve[] = [];
    for (let lane = 0; lane < topLanes.length; lane++) {
      if (topLanes[lane] === null) continue;
      if (lane === nodeLane) continue;
      if (incoming.includes(lane)) {
        // Was heading to this commit → curve into the node.
        inbound.push({ lane, color: laneColor(lane), dashed: topDashed[lane] || undefined });
      } else if (lanes[lane] === topLanes[lane]) {
        // Unrelated branch passing straight through.
        verticals.push({ lane, color: laneColor(lane), dashed: topDashed[lane] || undefined });
      }
    }

    return {
      node: nodeLane,
      color: laneColor(nodeLane),
      dashed: isStash || undefined,
      working: commit.working || undefined,
      verticals: verticals.length ? verticals : undefined,
      in: inbound.length ? inbound : undefined,
      out: out.length ? out : undefined,
      endTop: isTip || undefined,
      endBottom: commit.parents.length === 0 || undefined,
    };
  });
}
