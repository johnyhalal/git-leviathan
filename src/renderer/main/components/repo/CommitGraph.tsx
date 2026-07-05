import { GRAPH_COLORS, type GraphNode } from './graph';

const LANE_GAP = 20;
/** Horizontal gutter before lane 0 and past the last lane. Sized to fully clear
 *  the avatar node (radius + ring ≈ 11px), which is wider than a plain lane dot. */
const PAD_X = 13;
const NODE_R = 4.5;
/** Dash pattern for stash lines (dot-dot). */
const DASH = '4 2';
/** Stroke width for every lane line and connector. */
const PADDING = 3;
/** Stroke width for every lane line and connector. */
const STROKE_W = 2;
/** Radius of the author-avatar node (larger than the plain dot). */
const AVATAR_R = 10;
/** Side of the stash node's dotted square, and the tray glyph drawn inside it. */
const STASH_BOX = 18;
const STASH_TRAY = 13;
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

/** Minimum graph cell width, so a single-lane graph still reserves room for the
 *  avatar node and its lane wash rather than collapsing to a sliver. */
const MIN_CELL_WIDTH = 100;

/** Pixel width a graph cell needs to hold lanes `0..maxLane` (never below the
 *  minimum, so a single lane keeps a comfortable column). */
export const graphCellWidth = (maxLane: number) =>
  Math.max(MIN_CELL_WIDTH, PAD_X * 2 + maxLane * LANE_GAP);

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
  const width = graphCellWidth(maxLane);
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
      {/* Faint wash in the node's lane color, from the avatar centre out to the
          cell's right edge — the same hue as the lane line at 10% alpha, capped
          on the right by a solid line in the full lane color. */}
      <rect
        x={nodeX}
        y={PADDING}
        width={Math.max(0, width - nodeX)}
        height={rowHeight-PADDING*2}
        fill={`${nodeColor}1a`}
      />
      <line
        x1={width - 13}
        y1={PADDING}
        x2={width - 13}
        y2={rowHeight-PADDING}
        stroke={nodeColor}
        strokeWidth={STROKE_W}
      />

      {/* Straight branch lines passing fully through the row. */}
      {graph.verticals?.map((v) => (
        <line
          key={`v-${v.lane}`}
          x1={laneX(v.lane)}
          y1={0}
          x2={laneX(v.lane)}
          y2={rowHeight}
          stroke={color(v.color)}
          strokeWidth={STROKE_W}
          strokeDasharray={v.dashed ? DASH : undefined}
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
          strokeWidth={STROKE_W}
          strokeDasharray={graph.dashed ? DASH : undefined}
        />
      )}
      {!graph.endBottom && (
        <line
          x1={nodeX}
          y1={mid}
          x2={nodeX}
          y2={rowHeight}
          stroke={nodeColor}
          strokeWidth={STROKE_W}
          strokeDasharray={graph.dashed ? DASH : undefined}
        />
      )}

      {/* Elbows entering from the top (a branch merging into this node). */}
      {graph.in?.map((c) => (
        <path
          key={`in-${c.lane}`}
          d={elbowIn(laneX(c.lane), nodeX, mid)}
          fill="none"
          stroke={color(c.color)}
          strokeWidth={STROKE_W}
          strokeDasharray={c.dashed ? DASH : undefined}
        />
      ))}

      {/* Elbows leaving toward the bottom (a branch forking off this node). */}
      {graph.out?.map((c) => (
        <path
          key={`out-${c.lane}`}
          d={elbowOut(nodeX, laneX(c.lane), mid, rowHeight)}
          fill="none"
          stroke={color(c.color)}
          strokeWidth={STROKE_W}
        />
      ))}

      {/* The node itself. The working-tree row is an empty, avatar-sized circle
          with a dotted lane-colored ring (no image, no fill). A stash is a
          dotted-outline square holding a small tray glyph, to set it apart from
          real commits; otherwise the author's avatar clipped to a circle with a
          lane-colored ring, or a plain dot when no avatar is available. */}
      {graph.working ? (
        <circle
          cx={nodeX}
          cy={mid}
          r={AVATAR_R}
          fill="var(--bg-elev)"
          stroke={nodeColor}
          strokeWidth={STROKE_W}
          strokeDasharray={DASH}
        />
      ) : graph.dashed ? (
        <g>
          <rect
            x={nodeX - STASH_BOX / 2}
            y={mid - STASH_BOX / 2}
            width={STASH_BOX}
            height={STASH_BOX}
            rx={3}
            fill="var(--bg-elev)"
            stroke={nodeColor}
            strokeWidth={STROKE_W}
            strokeDasharray={DASH}
          />
          <g
            transform={`translate(${nodeX - STASH_TRAY / 2} ${mid - STASH_TRAY / 2}) scale(${STASH_TRAY / 24})`}
            fill="none"
            stroke={nodeColor}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 12h-6l-2 3h-4l-2-3H2" vectorEffect="non-scaling-stroke" />
            <path
              d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </g>
      ) : avatarUrl ? (
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
            strokeWidth={STROKE_W}
          />
        </>
      ) : (
        <circle cx={nodeX} cy={mid} r={NODE_R} fill={nodeColor} />
      )}
    </svg>
  );
}
