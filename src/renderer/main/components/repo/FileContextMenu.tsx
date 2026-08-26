import { useState } from 'react';
import {
  ContextMenu,
  MenuRow,
  type ContextMenuEntry,
  type ContextMenuItem,
} from './ContextMenu';

/** One row in a working-tree file's right-click menu. */
export type FileMenuItem = ContextMenuItem;

/** A menu row or a divider between action groups. */
export type FileMenuEntry = ContextMenuEntry;

interface FileContextMenuProps {
  /** Viewport coordinates to anchor the menu at (the right-click point). */
  x: number;
  y: number;
  /** The rows to offer for the file, `'separator'` for a divider. Empty renders nothing. */
  items: FileMenuEntry[];
  /** Dismiss the menu (outside click, Escape, or after an item runs). */
  onClose: () => void;
}

/**
 * A right-click menu anchored at (x, y) offering per-file actions in the
 * working-tree lists — stage/unstage, discard, and an "Ignore" submenu. Rows with
 * a `submenu` open a flyout on hover, to the right of the row (or the left when it
 * would overflow the window).
 */
export function FileContextMenu({ x, y, items, onClose }: FileContextMenuProps) {
  // The row whose submenu is currently open (index into `items`), if any.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (items.length === 0) return null;
  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {items.map((item, index) =>
        item === 'separator' ? (
          <div key={`sep-${index}`} className="context-menu-sep" role="separator" />
        ) : (
          <MenuRow
            key={`${item.label}-${index}`}
            item={item}
            open={openIndex === index}
            // Hovering a plain row closes any open submenu; a parent row opens its own.
            onHover={() => setOpenIndex(item.submenu?.length ? index : null)}
            onClose={onClose}
          />
        ),
      )}
    </ContextMenu>
  );
}
