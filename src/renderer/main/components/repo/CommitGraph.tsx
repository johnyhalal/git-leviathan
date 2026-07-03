import { GRAPH_COLORS, type GraphNode } from './graph';

const LANE_GAP = 20;
const PAD_X = 12;
const NODE_R = 4.5;
/** Radius of the author-avatar node (larger than the plain dot). */
const AVATAR_R = 10;
/** Corner radius where an elbow connector turns from vertical to horizontal. */
const CORNER_R = 8;

/** Horizontal centre of a lane within the cell. */
const laneX = (lane: number) => PAD_X + lane * LANE_GAP;

/**
 * Elbow path for a branch merging in from the top: straight down its source
 * lane, a rounded corner, then straight across into the node at mid-height.
 */
function elbowIn(sourceX: number, nodeX: number, mid: number): string {
  const dir = Math.sign(nodeX - sourceX);
  const r = Math.min(CORNER_R, Math.abs(nodeX - sourceX), mid);
  return `M ${sourceX} 0 V ${mid - r} Q ${sourceX} ${mid} ${sourceX + dir * r} ${mid} H ${nodeX}`;
}

/**
 * Elbow path for a branch forking off toward the bottom: straight across from
 * the node, a rounded corner, then straight down its target lane.
 */
function elbowOut(
  nodeX: number,
  targetX: number,
  mid: number,
  rowHeight: number,
): string {
  const dir = Math.sign(targetX - nodeX);
  const r = Math.min(CORNER_R, Math.abs(targetX - nodeX), rowHeight - mid);
  return `M ${nodeX} ${mid} H ${targetX - dir * r} Q ${targetX} ${mid} ${targetX} ${mid + r} V ${rowHeight}`;
}

/** Pixel width a graph cell needs to hold lanes `0..maxLane`. */
export const graphCellWidth = (maxLane: number) => PAD_X * 2 + maxLane * LANE_GAP;

const color = (index: number) => GRAPH_COLORS[index] ?? GRAPH_COLORS[0];

interface CommitGraphProps {
  graph: GraphNode;
  /** Height of the row this cell sits in, in pixels. */
  rowHeight: number;
  /** Highest lane index used across the whole list (sets cell width). */
  maxLane: number;
  /** Author avatar shown as the node; falls back to a plain dot if absent. */
  avatarUrl?: string;
  /** Stable id (e.g. commit hash) to scope this cell's SVG clip-path. */
  nodeId: string;
}

/**
 * A single decorative graph cell. Purely visual — it draws whatever the row's
 * {@link GraphNode} descriptor says and computes nothing from real history.
 */
export function CommitGraph({
  graph,
  rowHeight,
  maxLane,
  avatarUrl,
  nodeId,
}: CommitGraphProps) {
  const width = PAD_X * 2 + maxLane * LANE_GAP;
  const mid = rowHeight / 2;
  const nodeX = laneX(graph.node);
  const nodeColor = color(graph.color);
  const clipId = `avatar-clip-${nodeId}`;

  return (
    <svg
      className="commit-graph"
      width={width}
      height={rowHeight}
      viewBox={`0 0 ${width} ${rowHeight}`}
      aria-hidden="true"
    >
      {/* Straight branch lines passing fully through the row. */}
      {graph.verticals?.map((v) => (
        <line
          key={`v-${v.lane}`}
          x1={laneX(v.lane)}
          y1={0}
          x2={laneX(v.lane)}
          y2={rowHeight}
          stroke={color(v.color)}
          strokeWidth={1.5}
        />
      ))}

      {/* The node's own lane line, split into halves so tips/bases can end. */}
      {!graph.endTop && (
        <line
          x1={nodeX}
          y1={0}
          x2={nodeX}
          y2={mid}
          stroke={nodeColor}
          strokeWidth={1.5}
        />
      )}
      {!graph.endBottom && (
        <line
          x1={nodeX}
          y1={mid}
          x2={nodeX}
          y2={rowHeight}
          stroke={nodeColor}
          strokeWidth={1.5}
        />
      )}

      {/* Elbows entering from the top (a branch merging into this node). */}
      {graph.in?.map((c) => (
        <path
          key={`in-${c.lane}`}
          d={elbowIn(laneX(c.lane), nodeX, mid)}
          fill="none"
          stroke={color(c.color)}
          strokeWidth={1.5}
        />
      ))}

      {/* Elbows leaving toward the bottom (a branch forking off this node). */}
      {graph.out?.map((c) => (
        <path
          key={`out-${c.lane}`}
          d={elbowOut(nodeX, laneX(c.lane), mid, rowHeight)}
          fill="none"
          stroke={color(c.color)}
          strokeWidth={1.5}
        />
      ))}

      {/* The node itself: the author's avatar clipped to a circle with a
          lane-colored ring, or a plain dot when no avatar is available. */}
      {avatarUrl ? (
        <>
          <clipPath id={clipId}>
            <circle cx={nodeX} cy={mid} r={AVATAR_R} />
          </clipPath>
          <circle cx={nodeX} cy={mid} r={AVATAR_R} fill="var(--bg-elev)" />
          <image
            href={avatarUrl}
            x={nodeX - AVATAR_R}
            y={mid - AVATAR_R}
            width={AVATAR_R * 2}
            height={AVATAR_R * 2}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
          />
          <circle
            cx={nodeX}
            cy={mid}
            r={AVATAR_R}
            fill="none"
            stroke={nodeColor}
            strokeWidth={1.5}
          />
        </>
      ) : (
        <circle cx={nodeX} cy={mid} r={NODE_R} fill={nodeColor} />
      )}
    </svg>
  );
}
