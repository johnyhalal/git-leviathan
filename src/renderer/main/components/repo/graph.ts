// Commit-graph layout: turns a linear, topo-ordered commit list (each with its
// parent hashes) into per-row descriptors the CommitGraph cell can draw.

/** Palette for graph lanes (teal / orange / purple accents), cycled by lane. */
export const GRAPH_COLORS = ['#43d7c7', '#e0823d', '#8b5cf6'] as const;

export const laneColor = (lane: number) => lane % GRAPH_COLORS.length;

/** A branch line that passes straight through a row. */
export interface GraphLane {
  lane: number;
  /** Index into {@link GRAPH_COLORS}. */
  color: number;
}

/** A quarter-curve connecting a row's node to a neighbouring lane. */
export interface GraphCurve {
  lane: number;
  /** Index into {@link GRAPH_COLORS}. */
  color: number;
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
}

interface GraphInput {
  hash: string;
  parents: string[];
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
  const firstFree = () => {
    const free = lanes.indexOf(null);
    return free === -1 ? lanes.length : free;
  };

  return commits.map((commit) => {
    const incoming: number[] = [];
    lanes.forEach((waiting, i) => {
      if (waiting === commit.hash) incoming.push(i);
    });

    const isTip = incoming.length === 0;
    const nodeLane = isTip ? firstFree() : incoming[0];

    // Snapshot the lanes entering this row from above.
    const topLanes = lanes.slice();

    // Lanes that were waiting for this commit (other than the node's) merge in.
    for (const lane of incoming) if (lane !== nodeLane) lanes[lane] = null;

    const out: GraphCurve[] = [];
    if (commit.parents.length === 0) {
      // Root commit: the node's lane ends here.
      lanes[nodeLane] = null;
    } else {
      // First parent continues straight down the node's lane.
      lanes[nodeLane] = commit.parents[0];
      // Extra parents (a merge) fork off to their own / an existing lane.
      for (let k = 1; k < commit.parents.length; k++) {
        const parent = commit.parents[k];
        let lane = lanes.indexOf(parent);
        if (lane === -1) {
          lane = firstFree();
          lanes[lane] = parent;
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
        inbound.push({ lane, color: laneColor(lane) });
      } else if (lanes[lane] === topLanes[lane]) {
        // Unrelated branch passing straight through.
        verticals.push({ lane, color: laneColor(lane) });
      }
    }

    return {
      node: nodeLane,
      color: laneColor(nodeLane),
      verticals: verticals.length ? verticals : undefined,
      in: inbound.length ? inbound : undefined,
      out: out.length ? out : undefined,
      endTop: isTip || undefined,
      endBottom: commit.parents.length === 0 || undefined,
    };
  });
}
