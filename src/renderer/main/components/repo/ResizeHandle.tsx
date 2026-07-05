interface ResizeHandleProps {
  onPointerDown: (event: React.PointerEvent) => void;
  'aria-label': string;
  /** Which column edge this handle sits on, for side-specific styling. */
  side: 'left' | 'right';
}

/** Thin draggable divider between two columns. */
export function ResizeHandle({ onPointerDown, 'aria-label': ariaLabel, side }: ResizeHandleProps) {
  return (
    <div
      className={`repo-resize-handle repo-resize-handle-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
    />
  );
}
