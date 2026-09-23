import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { CheckIcon, MinusIcon, PlusIcon, SparkleIcon } from '../../../../../assets/icons';
import type { ConflictFileContent, ConflictImage, ResolveBlockRequest } from '../../../../types/ipc';

/**
 * The line-by-line merge editor for one conflicted file: the two sources (ours |
 * theirs) side by side on top, the editable output below, all three scrolling in
 * lockstep. Git's conflict markers in the working copy are parsed into shared
 * context plus conflict blocks; every block is laid out at the same height in
 * all three panes (shorter sides get filler rows), so a synced `scrollTop` keeps
 * them aligned.
 *
 * Inside a conflict each source line has a hover +/− that adds it to the output
 * — in the order the lines were picked, so taking ours' line 1 then theirs'
 * line 1 gives the opposite result to the reverse — a checkbox beside the block
 * takes the whole side, and the output is a plain textarea per block for hand
 * edits on top. Each output block can also ask Claude for a suggestion, which
 * lands in the output as an edit to review. The assembled result is reported
 * via `onChange` — null while any conflict is still undecided.
 */
interface MergeEditorProps {
  content: ConflictFileContent;
  /** The current merged text, or null while unresolved (disables "Mark resolved"). */
  onChange: (assembled: string | null) => void;
  /** Resolve the file by taking one side whole (the image view's pick buttons). */
  onPickSide: (side: 'ours' | 'theirs') => void;
  /** A resolution is in flight — disables the pick buttons. */
  busy: boolean;
  /**
   * Ask Claude to resolve one conflict block. Resolves with its suggestion, or
   * null when it failed (the caller has already told the user why).
   */
  onAskClaude: (request: ResolveBlockRequest) => Promise<{ lines: string[]; rationale: string } | null>;
  /** Imperative handle for the resolver's footer (whole-file Auto Resolve). */
  ref?: Ref<MergeEditorHandle>;
}

/** What the resolver's footer can drive on the editor. */
export interface MergeEditorHandle {
  /**
   * Auto Resolve every still-undecided conflict with Claude, a few at a time,
   * stopping after the first failure. Resolves once the run is over.
   */
  autoResolveAll: () => Promise<void>;
}

/** Claude requests a whole-file Auto Resolve keeps in flight at once. */
const AUTO_RESOLVE_CONCURRENCY = 3;

/** Unconflicted lines above/below a block sent to Claude as context. */
const CLAUDE_CONTEXT_LINES = 20;

/** Row height in px, handed to the CSS as `--merge-row-h` so both agree. */
const ROW_H = 20;

type Side = 'ours' | 'theirs';

type Segment = { type: 'common'; lines: string[] } | { type: 'conflict'; ours: string[]; theirs: string[] };

/** One source line taken into a conflict's output. */
interface Pick {
  side: Side;
  line: number;
}

/** The output state of one segment, parallel to `segments`. */
interface Block {
  /** A conflict's picked lines, in pick order — the output's order (empty for context). */
  picks: Pick[];
  /** Hand-edited since the last pick (a new pick rebuilds from the picks). */
  edited: boolean;
  /** Claude's reason, while the output is its untouched suggestion. */
  claudeNote?: string;
  /**
   * Claude has resolved this block — its Auto Resolve button stays hidden
   * through later picks and edits, until Reset starts the block over.
   */
  claudeUsed?: boolean;
  /** The segment's output lines, or null while a conflict is undecided. */
  lines: string[] | null;
}

interface Parsed {
  segments: Segment[];
  /** Branch/commit names from the first conflict's `<<<<<<<` / `>>>>>>>` markers. */
  oursLabel: string;
  theirsLabel: string;
}

/** Split a working file's lines into shared context and conflict blocks. */
function parseSegments(lines: string[]): Parsed {
  const segments: Segment[] = [];
  let oursLabel = '';
  let theirsLabel = '';
  let common: string[] = [];
  const flushCommon = () => {
    if (common.length) segments.push({ type: 'common', lines: common });
    common = [];
  };
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) {
      common.push(lines[i]);
      i++;
      continue;
    }
    flushCommon();
    oursLabel ||= lines[i].slice(7).trim();
    const ours: string[] = [];
    const theirs: string[] = [];
    i++;
    while (i < lines.length && !lines[i].startsWith('|||||||') && !lines[i].startsWith('=======')) {
      ours.push(lines[i]);
      i++;
    }
    // Optional diff3 "base" section — neither side's content, so skip it.
    if (i < lines.length && lines[i].startsWith('|||||||')) {
      while (i < lines.length && !lines[i].startsWith('=======')) i++;
    }
    if (i < lines.length) i++; // "======="
    while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
      theirs.push(lines[i]);
      i++;
    }
    if (i < lines.length) {
      theirsLabel ||= lines[i].slice(7).trim();
      i++;
    }
    segments.push({ type: 'conflict', ours, theirs });
  }
  flushCommon();
  return { segments, oursLabel, theirsLabel };
}

type ConflictSegment = Extract<Segment, { type: 'conflict' }>;

function initialBlock(seg: Segment): Block {
  return {
    picks: [],
    edited: false,
    lines: seg.type === 'common' ? seg.lines : null,
  };
}

/** A conflict block's output rebuilt from its picks, in pick order. */
function withPicks(seg: ConflictSegment, picks: Pick[]): Block {
  return { picks, edited: false, lines: picks.map((p) => seg[p.side][p.line]) };
}

/** Every line of `side`, top to bottom, as picks. */
function sidePicks(seg: ConflictSegment, side: Side): Pick[] {
  return seg[side].map((_, line) => ({ side, line }));
}

const isPicked = (picks: Pick[], side: Side, line: number) =>
  picks.some((p) => p.side === side && p.line === line);

/** Textarea text → lines; an emptied block holds no lines rather than one blank. */
function toLines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

export function MergeEditor({ content, onChange, onPickSide, busy, onAskClaude, ref }: MergeEditorProps) {
  // A CRLF file is edited with bare LFs (a textarea normalizes CR away) and
  // re-joined with CRLF on output, so the resolved file keeps its line endings.
  const eol = useMemo(() => (content.merged.some((l) => l.endsWith('\r')) ? '\r\n' : '\n'), [content.merged]);
  const { segments, oursLabel, theirsLabel } = useMemo(
    () => parseSegments(content.merged.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))),
    [content.merged],
  );
  const [blocks, setBlocks] = useState<Block[]>(() => segments.map(initialBlock));

  // Blocks with a Claude request in flight, by segment index.
  const [asking, setAsking] = useState<ReadonlySet<number>>(new Set());
  // The live segments, so a Claude answer arriving after the file changed is dropped.
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // Reset when a different file (or a reloaded copy) comes in.
  useEffect(() => {
    setBlocks(segments.map(initialBlock));
    setAsking(new Set());
  }, [segments]);

  const conflictIdx = useMemo(
    () => segments.flatMap((s, i) => (s.type === 'conflict' ? [i] : [])),
    [segments],
  );
  const ready = blocks.length === segments.length;
  const unresolved = ready ? conflictIdx.filter((i) => blocks[i].lines === null).length : 0;

  // Report the assembled result up.
  useEffect(() => {
    if (content.binary || !ready) {
      onChange(null);
      return;
    }
    if (blocks.some((b) => b.lines === null)) {
      onChange(null);
      return;
    }
    onChange(blocks.flatMap((b) => b.lines ?? []).join(eol));
  }, [content.binary, ready, blocks, eol, onChange]);

  // Rebuild one conflict block; `claudeUsed` carries over (only Reset clears it).
  const update = useCallback(
    (i: number, fn: (b: Block, seg: ConflictSegment) => Block) =>
      setBlocks((prev) =>
        prev.map((b, j) => {
          const seg = segments[j];
          return j === i && seg.type === 'conflict' ? { ...fn(b, seg), claudeUsed: b.claudeUsed } : b;
        }),
      ),
    [segments],
  );

  // Add a line to the end of the output, or take it back out.
  const toggleLine = (i: number, side: Side, line: number) =>
    update(i, (b, seg) =>
      withPicks(
        seg,
        isPicked(b.picks, side, line)
          ? b.picks.filter((p) => p.side !== side || p.line !== line)
          : [...b.picks, { side, line }],
      ),
    );

  // Take a whole side of a block, or drop all of that side again when it's
  // already all taken. Taking the block overrides any line-by-line order for
  // that side: its lines go in file order, where its first pick was (or at the
  // end when none of it was picked yet); the other side's picks stay put.
  const toggleSide = (i: number, side: Side) =>
    update(i, (b, seg) => {
      const others = b.picks.filter((p) => p.side !== side);
      if (seg[side].every((_, line) => isPicked(b.picks, side, line))) {
        return withPicks(seg, others);
      }
      const first = b.picks.findIndex((p) => p.side === side);
      const at = first === -1 ? others.length : first;
      return withPicks(seg, [...others.slice(0, at), ...sidePicks(seg, side), ...others.slice(at)]);
    });

  // Start the block over — undecided, and eligible for Auto Resolve again.
  const reset = (i: number) =>
    setBlocks((prev) => prev.map((b, j) => (j === i ? initialBlock(segments[i]) : b)));

  // Resolve every conflict with one side (per-line picks, not a file checkout).
  const takeAll = (side: Side) =>
    setBlocks((prev) =>
      prev.map((b, j) => {
        const seg = segments[j];
        return seg.type === 'common' ? b : withPicks(seg, sidePicks(seg, side));
      }),
    );

  const editOutput = (i: number, text: string) =>
    setBlocks((prev) =>
      prev.map((b, j) => (j === i ? { ...b, edited: true, claudeNote: undefined, lines: toLines(text) } : b)),
    );

  // The latest blocks, read by Claude runs that outlive the render they began in.
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  // Ask Claude for this block; its answer replaces the output as an edit to
  // review. Resolves true when a suggestion landed.
  const askClaude = async (i: number): Promise<boolean> => {
    const seg = segments[i];
    if (seg.type !== 'conflict' || asking.has(i) || blocksRef.current[i]?.claudeUsed) return false;
    const prev = segments[i - 1];
    const next = segments[i + 1];
    setAsking((s) => new Set(s).add(i));
    const answer = await onAskClaude({
      file: content.path,
      ours: seg.ours,
      theirs: seg.theirs,
      before: prev?.type === 'common' ? prev.lines.slice(-CLAUDE_CONTEXT_LINES) : [],
      after: next?.type === 'common' ? next.lines.slice(0, CLAUDE_CONTEXT_LINES) : [],
    }).catch(() => null);
    if (segmentsRef.current !== segments) return false;
    setAsking((s) => {
      const rest = new Set(s);
      rest.delete(i);
      return rest;
    });
    if (!answer) return false;
    setBlocks((all) =>
      all.map((b, j) =>
        j === i
          ? {
              picks: [],
              edited: true,
              claudeNote: answer.rationale,
              claudeUsed: true,
              lines: answer.lines,
            }
          : b,
      ),
    );
    return true;
  };

  useImperativeHandle(ref, () => ({
    autoResolveAll: async () => {
      const queue = conflictIdx.filter((i) => blocksRef.current[i]?.lines === null);
      let failed = false;
      const worker = async () => {
        for (let i = queue.shift(); i !== undefined && !failed; i = queue.shift()) {
          if (!(await askClaude(i))) failed = true;
        }
      };
      await Promise.all(Array.from({ length: AUTO_RESOLVE_CONCURRENCY }, worker));
    },
  }));

  // ---- synced scrolling ---------------------------------------------------

  const oursRef = useRef<HTMLDivElement>(null);
  const theirsRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  // The pane driving the current scroll; the echo scroll events its followers
  // fire are ignored until it goes quiet.
  const leader = useRef<HTMLDivElement | null>(null);
  const leaderTimer = useRef<number>(0);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const src = e.currentTarget;
    if (leader.current && leader.current !== src) return;
    leader.current = src;
    window.clearTimeout(leaderTimer.current);
    leaderTimer.current = window.setTimeout(() => (leader.current = null), 80);
    for (const pane of [oursRef.current, theirsRef.current, outputRef.current]) {
      if (!pane || pane === src) continue;
      pane.scrollTop = src.scrollTop;
      pane.scrollLeft = src.scrollLeft;
    }
  };

  useEffect(() => () => window.clearTimeout(leaderTimer.current), []);

  // Jump to the previous/next unresolved conflict (wrapping); any conflict when
  // they're all decided.
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cursor = useRef(-1);
  const jump = (dir: 1 | -1) => {
    const targets = conflictIdx.filter((i) => blocks[i]?.lines === null);
    const list = targets.length ? targets : conflictIdx;
    if (!list.length) return;
    const after = list.filter((i) => (dir === 1 ? i > cursor.current : i < cursor.current));
    const next = after.length
      ? after[dir === 1 ? 0 : after.length - 1]
      : list[dir === 1 ? 0 : list.length - 1];
    cursor.current = next;
    const el = blockRefs.current[next];
    const pane = outputRef.current;
    if (el && pane) pane.scrollTop = Math.max(0, el.offsetTop - ROW_H * 2);
  };

  if (content.images) {
    return <ImageConflict images={content.images} onPickSide={onPickSide} busy={busy} />;
  }

  if (content.binary) {
    return (
      <div className="merge-editor merge-editor-message">
        <p>This is a binary file. Choose a whole side to resolve it.</p>
        <SideButtons onPickSide={onPickSide} busy={busy} />
      </div>
    );
  }

  // A modify/delete (or rename) conflict leaves no markers in the file — there's
  // nothing to merge line by line, only which side to keep.
  if (conflictIdx.length === 0 && (content.ours === null || content.theirs === null)) {
    return (
      <div className="merge-editor merge-editor-message">
        {content.ours === null && content.theirs === null ? (
          <>
            <p>Both sides deleted (or renamed away) this file.</p>
            <div className="merge-message-actions">
              <button className="merge-side-button" disabled={busy} onClick={() => onPickSide('ours')}>
                Accept deletion
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              {content.ours === null
                ? 'Our side deleted this file; theirs kept it.'
                : 'Their side deleted this file; ours kept it.'}{' '}
              Choose a side, or mark it resolved as it is on disk.
            </p>
            <SideButtons
              onPickSide={onPickSide}
              busy={busy}
              oursDeletes={content.ours === null}
              theirsDeletes={content.theirs === null}
            />
          </>
        )}
      </div>
    );
  }

  if (!ready) return null;

  // Each segment's height in rows, shared by all three panes.
  const heights = segments.map((seg, i) => {
    const out = blocks[i].lines?.length ?? 0;
    return seg.type === 'common'
      ? Math.max(seg.lines.length, out, 1)
      : Math.max(seg.ours.length, seg.theirs.length, out, 1);
  });

  return (
    <div className="merge-editor" style={{ '--merge-row-h': `${ROW_H}px` } as React.CSSProperties}>
      <div className="merge-editor-bar">
        <span className={`merge-progress${unresolved === 0 ? ' is-done' : ''}`}>
          {conflictIdx.length === 0
            ? 'No conflict markers'
            : unresolved === 0
              ? `All ${conflictIdx.length} conflicts decided`
              : `${unresolved} of ${conflictIdx.length} conflicts left`}
        </span>
        <div className="merge-bar-actions">
          <button className="merge-bar-button" onClick={() => jump(-1)} disabled={!conflictIdx.length}>
            ↑ Prev
          </button>
          <button className="merge-bar-button" onClick={() => jump(1)} disabled={!conflictIdx.length}>
            ↓ Next
          </button>
          <span className="merge-bar-sep" />
          <button className="merge-bar-button" onClick={() => takeAll('ours')} disabled={!conflictIdx.length}>
            All ours
          </button>
          <button
            className="merge-bar-button"
            onClick={() => takeAll('theirs')}
            disabled={!conflictIdx.length}
          >
            All theirs
          </button>
        </div>
      </div>

      <div className="merge-sources">
        {(['ours', 'theirs'] as const).map((side) => (
          <section key={side} className={`merge-pane merge-pane-${side}`}>
            <header className="merge-pane-head">
              <span className="merge-pane-title">{side === 'ours' ? 'Ours' : 'Theirs'}</span>
              <span className="merge-pane-label">
                {(side === 'ours' ? oursLabel : theirsLabel) || (side === 'ours' ? 'current' : 'incoming')}
              </span>
            </header>
            <div className="merge-scroll" ref={side === 'ours' ? oursRef : theirsRef} onScroll={onScroll}>
              <SourceLines
                side={side}
                segments={segments}
                blocks={blocks}
                heights={heights}
                onToggleLine={toggleLine}
                onToggleSide={toggleSide}
              />
            </div>
          </section>
        ))}
      </div>

      <section className="merge-pane merge-pane-output">
        <header className="merge-pane-head">
          <span className="merge-pane-title">Output</span>
          <span className="merge-pane-label">tick lines above, or type here</span>
        </header>
        <div className="merge-scroll" ref={outputRef} onScroll={onScroll}>
          <div className="merge-doc">
            {(() => {
              let n = 0;
              return segments.map((seg, i) => {
                const block = blocks[i];
                const lines = block.lines;
                const start = n;
                n += lines?.length ?? 0;
                const longest = Math.max(0, ...(lines ?? []).map((l) => l.length));
                const isConflict = seg.type === 'conflict';
                return (
                  <div
                    key={i}
                    ref={(el) => {
                      blockRefs.current[i] = el;
                    }}
                    className={`merge-out-block${
                      isConflict ? (lines === null ? ' is-unresolved' : ' is-resolved') : ''
                    }`}
                    style={{ height: heights[i] * ROW_H }}
                  >
                    <div className="merge-gutter">
                      {(lines ?? []).map((_, k) => (
                        <div key={k} className="merge-num">
                          {start + k + 1}
                        </div>
                      ))}
                    </div>
                    <textarea
                      className="merge-out-text"
                      value={(lines ?? []).join('\n')}
                      placeholder={
                        lines === null
                          ? 'Unresolved — tick lines in Ours / Theirs, or type the result'
                          : undefined
                      }
                      wrap="off"
                      spellCheck={false}
                      style={{ minWidth: `${longest + 2}ch` }}
                      onChange={(e) => editOutput(i, e.target.value)}
                      // The textarea is sized to its block; keep it from scrolling
                      // itself so the synced panes stay aligned.
                      onScroll={(e) => {
                        e.currentTarget.scrollTop = 0;
                        e.currentTarget.scrollLeft = 0;
                      }}
                      aria-label={isConflict ? 'Conflict result' : 'Merged lines'}
                    />
                    {/* A zero-width rail pinned to the pane's right edge (sticky),
                        so the block's controls stay in view on horizontal scroll. */}
                    {isConflict && (
                      <div className="merge-out-side">
                        <div className="merge-out-controls">
                          {lines !== null && (
                            <div className={`merge-block-tools${block.claudeUsed ? ' is-pinned' : ''}`}>
                              {block.claudeNote ? (
                                <span className="merge-edited is-claude" data-tooltip={block.claudeNote}>
                                  <SparkleIcon size={11} /> Claude
                                </span>
                              ) : (
                                block.edited && <span className="merge-edited">edited</span>
                              )}
                              <button
                                onClick={() => reset(i)}
                                data-tooltip="Mark this conflict undecided again"
                              >
                                Reset
                              </button>
                            </div>
                          )}
                          {/* Once Claude has answered, only Reset (which re-arms this) remains. */}
                          {!block.claudeUsed && (
                            <button
                              className={`merge-ai pill-btn-rainbow${asking.has(i) ? ' is-busy' : ''}`}
                              onClick={() => void askClaude(i)}
                              disabled={asking.has(i)}
                              data-tooltip="Resolve this conflict with Claude"
                            >
                              {asking.has(i) ? (
                                <span className="mini-spinner" aria-hidden="true" />
                              ) : (
                                <SparkleIcon size={12} />
                              )}
                              {asking.has(i) ? 'Resolving…' : 'Auto Resolve'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </section>
    </div>
  );
}

interface SourceLinesProps {
  side: Side;
  segments: Segment[];
  blocks: Block[];
  heights: number[];
  onToggleLine: (block: number, side: Side, line: number) => void;
  onToggleSide: (block: number, side: Side) => void;
}

/** One source side of the file: shared context plus its half of every conflict. */
function SourceLines({ side, segments, blocks, heights, onToggleLine, onToggleSide }: SourceLinesProps) {
  let n = 0;
  return (
    <div className="merge-doc">
      {segments.map((seg, i) => {
        const lines = seg.type === 'common' ? seg.lines : seg[side];
        const start = n;
        n += lines.length;
        const filler = heights[i] - lines.length;
        const isConflict = seg.type === 'conflict';
        const picks = lines.map((_, k) => isConflict && isPicked(blocks[i].picks, side, k));
        const picked = picks.filter(Boolean).length;

        return (
          <div key={i} className={`merge-src-block${isConflict ? ` is-conflict is-${side}` : ''}`}>
            {/* The block checkbox, centred over the whole block (filler rows
                included, so it matches the other pane). A zero-height sticky
                anchor keeps it pinned left; it hangs down over the rows. */}
            {isConflict && lines.length > 0 && (
              <div className="merge-block-anchor">
                <span className="merge-block-check" style={{ height: heights[i] * ROW_H }}>
                  <BlockCheckbox
                    checked={picked === picks.length}
                    indeterminate={picked > 0 && picked < picks.length}
                    onChange={() => onToggleSide(i, side)}
                  />
                </span>
              </div>
            )}
            {lines.map((line, k) => (
              <div
                key={k}
                className={`merge-row${isConflict ? ' is-pickable' : ''}${picks[k] ? ' is-picked' : ''}`}
              >
                {/* Sticky, so the controls and number stay put on horizontal scroll. */}
                <span className="merge-src-gutter">
                  <span className="merge-block-slot" />
                  <span className="merge-line-toggle">
                    {isConflict && (
                      <button
                        onClick={() => onToggleLine(i, side, k)}
                        aria-label={picks[k] ? 'Remove line from output' : 'Add line to output'}
                      >
                        {picks[k] ? (
                          <>
                            {/* Picked: a check at rest, the remove glyph on hover. */}
                            <span className="merge-icon-picked">
                              <CheckIcon size={9} />
                            </span>
                            <span className="merge-icon-remove">
                              <MinusIcon size={9} />
                            </span>
                          </>
                        ) : (
                          <PlusIcon size={9} />
                        )}
                      </button>
                    )}
                  </span>
                  <span className="merge-num">{start + k + 1}</span>
                </span>
                <span className="merge-code">{line}</span>
              </div>
            ))}
            {filler > 0 && (
              <div className="merge-filler" style={{ height: filler * ROW_H }}>
                <span className="merge-src-gutter" />
                {lines.length === 0 && <span className="merge-filler-note">no lines on this side</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface BlockCheckboxProps {
  checked: boolean;
  /** Some but not all of the block's lines are taken. */
  indeterminate: boolean;
  onChange: () => void;
}

/** The take-whole-block checkbox beside a conflict's lines (tri-state). */
function BlockCheckbox({ checked, indeterminate, onChange }: BlockCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={checked ? 'Remove block from output' : 'Add block to output'}
      data-tooltip={checked ? 'Remove block' : 'Take block'}
    />
  );
}

interface SideButtonsProps {
  onPickSide: (side: Side) => void;
  busy: boolean;
  /** That side deleted the file, so taking it deletes the file. */
  oursDeletes?: boolean;
  theirsDeletes?: boolean;
}

/** Whole-side picks for a file with nothing to merge line by line. */
function SideButtons({ onPickSide, busy, oursDeletes, theirsDeletes }: SideButtonsProps) {
  return (
    <div className="merge-message-actions">
      <button className="merge-side-button" disabled={busy} onClick={() => onPickSide('ours')}>
        {oursDeletes ? 'Use ours (delete file)' : 'Use ours'}
      </button>
      <button className="merge-side-button" disabled={busy} onClick={() => onPickSide('theirs')}>
        {theirsDeletes ? 'Use theirs (delete file)' : 'Use theirs'}
      </button>
    </div>
  );
}

/** Human-readable byte size. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface ImageConflictProps {
  images: NonNullable<ConflictFileContent['images']>;
  onPickSide: (side: Side) => void;
  busy: boolean;
}

/** An image conflict: both sides (and the base, when there is one) side by side. */
function ImageConflict({ images, onPickSide, busy }: ImageConflictProps) {
  const cards: {
    key: string;
    title: string;
    image: ConflictImage | null;
    side?: Side;
  }[] = [
    { key: 'ours', title: 'Ours', image: images.ours, side: 'ours' },
    { key: 'theirs', title: 'Theirs', image: images.theirs, side: 'theirs' },
  ];
  if (images.base) cards.push({ key: 'base', title: 'Base', image: images.base });
  return (
    <div className="merge-editor merge-images">
      {cards.map(({ key, title, image, side }) => (
        <ImageCard
          key={key}
          kind={key}
          title={title}
          image={image}
          onPick={side && (() => onPickSide(side))}
          busy={busy}
        />
      ))}
    </div>
  );
}

interface ImageCardProps {
  kind: string;
  title: string;
  image: ConflictImage | null;
  onPick?: () => void;
  busy: boolean;
}

function ImageCard({ kind, title, image, onPick, busy }: ImageCardProps) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [broken, setBroken] = useState(false);
  return (
    <section className={`merge-image-card is-${kind}`}>
      <header className="merge-pane-head">
        <span className="merge-pane-title">{title}</span>
        <span className="merge-pane-label">
          {image
            ? [size && `${size.w} × ${size.h}`, formatBytes(image.bytes)].filter(Boolean).join(' · ')
            : 'deleted'}
        </span>
      </header>
      <div className="merge-image-stage">
        {!image ? (
          <span className="merge-image-note">This side deleted the image.</span>
        ) : !image.url ? (
          <span className="merge-image-note">Too large to preview.</span>
        ) : broken ? (
          <span className="merge-image-note">Can't display this image.</span>
        ) : (
          <img
            src={image.url}
            alt={`${title} version`}
            onLoad={(e) =>
              setSize({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            onError={() => setBroken(true)}
          />
        )}
      </div>
      {onPick && (
        <button className="merge-side-button merge-image-pick" disabled={busy} onClick={onPick}>
          {image ? `Use ${title.toLowerCase()}` : `Use ${title.toLowerCase()} (delete image)`}
        </button>
      )}
    </section>
  );
}
