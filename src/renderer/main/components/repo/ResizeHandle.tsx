interface ResizeHandleProps {
  onPointerDown: (event: React.PointerEvent) => void;
  'aria-label': string;
}

/** Thin draggable divider between two columns. */
export function ResizeHandle({ onPointerDown, 'aria-label': ariaLabel }: ResizeHandleProps) {
  return (
    <div
      className="repo-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
    />
  );
}
