import { useCallback, useEffect, useRef, useState } from 'react';

type Side = 'left' | 'right';

const MIN_WIDTH = 160;
// The right column (commit panel) needs more room for its content.
const RIGHT_MIN_WIDTH = 300;
const MAX_WIDTH = 560;

const clamp = (value: number, min = MIN_WIDTH) =>
  Math.min(MAX_WIDTH, Math.max(min, value));

interface DragState {
  side: Side;
  startX: number;
  startWidth: number;
}

/**
 * Holds the pixel widths of the left and right columns; the middle column is
 * left to flex. `startResize(side)` returns a pointer-down handler for a
 * divider — dragging it grows/shrinks the adjacent column within min/max.
 * `leftMin` overrides the left column's minimum (e.g. the file-history sidebar,
 * which needs more room than the repo sidebar).
 */
export function useResizableColumns(
  initialLeft: number,
  initialRight: number,
  leftMin: number = MIN_WIDTH,
) {
  const [leftWidth, setLeftWidth] = useState(clamp(initialLeft, leftMin));
  const [rightWidth, setRightWidth] = useState(clamp(initialRight, RIGHT_MIN_WIDTH));
  const drag = useRef<DragState | null>(null);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      const delta = event.clientX - state.startX;
      // The right divider grows the right column as the pointer moves left.
      const next = clamp(
        state.side === 'left'
          ? state.startWidth + delta
          : state.startWidth - delta,
        state.side === 'left' ? leftMin : RIGHT_MIN_WIDTH,
      );
      if (state.side === 'left') setLeftWidth(next);
      else setRightWidth(next);
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
  }, [leftMin]);

  const startResize = useCallback(
    (side: Side) => (event: React.PointerEvent) => {
      event.preventDefault();
      drag.current = {
        side,
        startX: event.clientX,
        startWidth: side === 'left' ? leftWidth : rightWidth,
      };
      document.body.classList.add('is-col-resizing');
    },
    [leftWidth, rightWidth],
  );

  return { leftWidth, rightWidth, startResize };
}
