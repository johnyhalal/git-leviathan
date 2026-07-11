import { useEffect, useMemo, useState } from 'react';
import type { ConflictFileContent } from '../../../../types/ipc';

/**
 * The side-by-side (ours | result | theirs) merge editor for one conflicted
 * file. It parses git's conflict markers in the working copy into aligned
 * segments — shared context plus conflict blocks — and lets the user pick a side
 * (or take both) per block. The assembled result is reported up via `onChange`
 * (null while any block is still undecided). A manual mode drops to a raw
 * textarea for hand-merging anything the pickers can't express.
 */
interface MergeEditorProps {
  content: ConflictFileContent;
  /** The current merged text, or null while unresolved (disables "Mark resolved"). */
  onChange: (assembled: string | null) => void;
}

type Choice = 'ours' | 'theirs' | 'both' | 'both-swapped';

type Segment =
  | { type: 'common'; lines: string[] }
  | { type: 'conflict'; ours: string[]; theirs: string[] };

/** Split a working file's lines into shared context and conflict blocks. */
function parseSegments(lines: string[]): Segment[] {
  const segments: Segment[] = [];
  let common: string[] = [];
  const flushCommon = () => {
    if (common.length) segments.push({ type: 'common', lines: common });
    common = [];
  };
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      flushCommon();
      const ours: string[] = [];
      const theirs: string[] = [];
      i++; // skip the "<<<<<<< ours" marker
      while (i < lines.length && !lines[i].startsWith('|||||||') && !lines[i].startsWith('=======')) {
        ours.push(lines[i]);
        i++;
      }
      // Optional diff3 "base" section — shown as neither side, so skip it.
      if (i < lines.length && lines[i].startsWith('|||||||')) {
        i++;
        while (i < lines.length && !lines[i].startsWith('=======')) i++;
      }
      if (i < lines.length && lines[i].startsWith('=======')) i++;
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        theirs.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].startsWith('>>>>>>>')) i++;
      segments.push({ type: 'conflict', ours, theirs });
    } else {
      common.push(lines[i]);
      i++;
    }
  }
  flushCommon();
  return segments;
}

/** Assemble the merged text from the per-conflict choices, or null if undecided. */
function assemble(segments: Segment[], choices: (Choice | null)[]): string | null {
  const out: string[] = [];
  let ci = 0;
  for (const seg of segments) {
    if (seg.type === 'common') {
      out.push(...seg.lines);
      continue;
    }
    const choice = choices[ci];
    ci++;
    if (!choice) return null;
    if (choice === 'ours') out.push(...seg.ours);
    else if (choice === 'theirs') out.push(...seg.theirs);
    else if (choice === 'both') out.push(...seg.ours, ...seg.theirs);
    else out.push(...seg.theirs, ...seg.ours);
  }
  return out.join('\n');
}

function Lines({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <div className={`merge-lines${className ? ` ${className}` : ''}`}>
      {lines.length === 0 ? (
        <div className="merge-line merge-line-empty">(empty)</div>
      ) : (
        lines.map((line, i) => (
          <div key={i} className="merge-line">
            <span className="merge-code">{line || ' '}</span>
          </div>
        ))
      )}
    </div>
  );
}

export function MergeEditor({ content, onChange }: MergeEditorProps) {
  const segments = useMemo(() => parseSegments(content.merged), [content.merged]);
  const conflictCount = useMemo(
    () => segments.filter((s) => s.type === 'conflict').length,
    [segments],
  );

  const [choices, setChoices] = useState<(Choice | null)[]>([]);
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState('');

  // Reset picker/manual state whenever a different file is loaded in.
  useEffect(() => {
    setChoices(new Array(conflictCount).fill(null));
    setManual(false);
    setDraft(content.merged.join('\n'));
  }, [content.path, conflictCount, content.merged]);

  // Report the assembled result up as choices (or the manual draft) change.
  useEffect(() => {
    if (content.binary) {
      onChange(null);
      return;
    }
    onChange(manual ? draft : assemble(segments, choices));
  }, [content.binary, manual, draft, segments, choices, onChange]);

  if (content.binary) {
    return (
      <div className="merge-editor merge-editor-binary">
        <p>This is a binary file. Choose a whole side to resolve it.</p>
      </div>
    );
  }

  if (manual) {
    return (
      <div className="merge-editor merge-editor-manual">
        <div className="merge-editor-bar">
          <button className="merge-mode-toggle" onClick={() => setManual(false)}>
            Back to guided merge
          </button>
        </div>
        <textarea
          className="merge-textarea"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Merged file content"
        />
      </div>
    );
  }

  const setChoice = (conflictIndex: number, choice: Choice) =>
    setChoices((prev) => {
      const next = [...prev];
      next[conflictIndex] = choice;
      return next;
    });

  let conflictIndex = -1;
  return (
    <div className="merge-editor">
      <div className="merge-editor-bar">
        <span className="merge-editor-heads">
          <span>Ours (current)</span>
          <span>Result</span>
          <span>Theirs (incoming)</span>
        </span>
        <button className="merge-mode-toggle" onClick={() => setManual(true)}>
          Edit manually
        </button>
      </div>
      <div className="merge-grid">
        {segments.map((seg, i) => {
          if (seg.type === 'common') {
            return (
              <div key={i} className="merge-row merge-row-common">
                <Lines lines={seg.lines} className="merge-pane-common" />
              </div>
            );
          }
          conflictIndex++;
          const ci = conflictIndex;
          const choice = choices[ci];
          const resultLines =
            choice === 'ours'
              ? seg.ours
              : choice === 'theirs'
                ? seg.theirs
                : choice === 'both'
                  ? [...seg.ours, ...seg.theirs]
                  : choice === 'both-swapped'
                    ? [...seg.theirs, ...seg.ours]
                    : null;
          return (
            <div key={i} className="merge-row merge-row-conflict">
              <div className={`merge-cell merge-cell-ours${choice === 'ours' ? ' is-chosen' : ''}`}>
                <Lines lines={seg.ours} className="merge-pane-ours" />
                <button className="merge-pick" onClick={() => setChoice(ci, 'ours')}>
                  ◀ Take ours
                </button>
              </div>
              <div className="merge-cell merge-cell-result">
                {resultLines ? (
                  <Lines lines={resultLines} className="merge-pane-result" />
                ) : (
                  <div className="merge-unchosen">Pick a side ↓</div>
                )}
                <div className="merge-both">
                  <button onClick={() => setChoice(ci, 'both')}>Ours + theirs</button>
                  <button onClick={() => setChoice(ci, 'both-swapped')}>Theirs + ours</button>
                </div>
              </div>
              <div className={`merge-cell merge-cell-theirs${choice === 'theirs' ? ' is-chosen' : ''}`}>
                <Lines lines={seg.theirs} className="merge-pane-theirs" />
                <button className="merge-pick" onClick={() => setChoice(ci, 'theirs')}>
                  Take theirs ▶
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
