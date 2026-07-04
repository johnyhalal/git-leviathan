import { useCallback, useEffect, useRef, useState } from 'react';

export type CommitColumnKey = 'refs' | 'graph' | 'message' | 'date' | 'author';

export interface CommitColumnDef {
  key: CommitColumnKey;
  label: string;
  /** Draggable width. Graph is data-derived and message is the flex filler. */
  resizable: boolean;
  minWidth: number;
  defaultWidth: number;
}

/**
 * Column metadata for the commit list, in default order. Widths only apply to
 * resizable columns; the graph column is sized from the graph data and the
 * message column absorbs the leftover space (the table is `table-layout: fixed`).
 */
export const COMMIT_COLUMNS: CommitColumnDef[] = [
  { key: 'refs', label: 'Branch / Tag', resizable: true, minWidth: 80, defaultWidth: 160 },
  { key: 'graph', label: 'Graph', resizable: false, minWidth: 0, defaultWidth: 0 },
  { key: 'message', label: 'Commit Message', resizable: false, minWidth: 0, defaultWidth: 0 },
  { key: 'date', label: 'Commit Date/Time', resizable: true, minWidth: 90, defaultWidth: 150 },
  { key: 'author', label: 'Author', resizable: true, minWidth: 80, defaultWidth: 150 },
];

const MAX_WIDTH = 560;
const STORAGE_KEY = 'commitColumns.v1';
const DEFAULT_ORDER = COMMIT_COLUMNS.map((c) => c.key);
const META = new Map(COMMIT_COLUMNS.map((c) => [c.key, c]));

const clampWidth = (key: CommitColumnKey, value: number) => {
  const min = META.get(key)?.minWidth ?? 0;
  return Math.min(MAX_WIDTH, Math.max(min, value));
};

interface StoredLayout {
  order: CommitColumnKey[];
  widths: Partial<Record<CommitColumnKey, number>>;
}

function defaultWidths(): Record<CommitColumnKey, number> {
  const out = {} as Record<CommitColumnKey, number>;
  for (const c of COMMIT_COLUMNS) out[c.key] = c.defaultWidth;
  return out;
}

/** Read a persisted layout, dropping anything that no longer matches META. */
function loadLayout(): StoredLayout {
  const fallback: StoredLayout = { order: DEFAULT_ORDER, widths: defaultWidths() };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredLayout>;
    // Keep only known keys, then append any columns the store was missing so a
    // newly added column can't vanish from the header.
    const known = (parsed.order ?? []).filter((k) => META.has(k));
    const order = [...known, ...DEFAULT_ORDER.filter((k) => !known.includes(k))];
    const widths = defaultWidths();
    for (const [k, v] of Object.entries(parsed.widths ?? {})) {
      if (META.has(k as CommitColumnKey) && typeof v === 'number') {
        widths[k as CommitColumnKey] = clampWidth(k as CommitColumnKey, v);
      }
    }
    return { order, widths };
  } catch {
    return fallback;
  }
}

interface DragState {
  key: CommitColumnKey;
  startX: number;
  startWidth: number;
}

/**
 * Ordered widths for the commit-list columns, with drag-to-resize and
 * drag-to-reorder. `startResize(key)` returns a pointer-down handler for a
 * column's resize grip; `moveColumn(from, to)` drops `from` into `to`'s slot.
 * The layout is persisted to localStorage so it survives reloads.
 */
export function useCommitColumns() {
  const [initial] = useState(loadLayout);
  const [order, setOrder] = useState<CommitColumnKey[]>(initial.order);
  const [widths, setWidths] = useState<Record<CommitColumnKey, number>>(() => ({
    ...defaultWidths(),
    ...initial.widths,
  }));
  const drag = useRef<DragState | null>(null);

  useEffect(() => {
    const layout: StoredLayout = { order, widths };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      /* storage unavailable — keep the in-memory layout only */
    }
  }, [order, widths]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      const next = clampWidth(state.key, state.startWidth + (event.clientX - state.startX));
      setWidths((prev) => (prev[state.key] === next ? prev : { ...prev, [state.key]: next }));
    };
    const onUp = () => {
      drag.current = null;
      document.body.classList.remove('is-col-resizing');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const startResize = useCallback(
    (key: CommitColumnKey) => (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      drag.current = { key, startX: event.clientX, startWidth: widths[key] };
      document.body.classList.add('is-col-resizing');
    },
    [widths],
  );

  const moveColumn = useCallback(
    (from: CommitColumnKey, to: CommitColumnKey, side: 'before' | 'after') => {
      if (from === to) return;
      setOrder((prev) => {
        const next = prev.filter((k) => k !== from);
        const at = next.indexOf(to);
        if (at < 0) return prev;
        next.splice(side === 'after' ? at + 1 : at, 0, from);
        return next;
      });
    },
    [],
  );

  const resetColumns = useCallback(() => {
    setOrder(DEFAULT_ORDER);
    setWidths(defaultWidths());
  }, []);

  return { order, widths, startResize, moveColumn, resetColumns };
}
