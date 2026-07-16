import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRightIcon } from '../../../../../assets/icons';
import { ContextMenu } from './ContextMenu';

/** Gap kept between a flyout submenu and the viewport edge. */
const EDGE_MARGIN = 8;

/** One row in a working-tree file's right-click menu. */
export interface FileMenuItem {
  label: string;
  danger?: boolean;
  /** Runs when the row is chosen. Omit for a parent row that only opens a submenu. */
  onClick?: () => void;
  /** Nested rows; when present the row opens a flyout instead of acting on click. */
  submenu?: FileMenuItem[];
}

interface FileContextMenuProps {
  /** Viewport coordinates to anchor the menu at (the right-click point). */
  x: number;
  y: number;
  /** The actions to offer for the file. Renders nothing when empty. */
  items: FileMenuItem[];
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
      {items.map((item, index) => (
        <MenuRow
          key={`${item.label}-${index}`}
          item={item}
          open={openIndex === index}
          // Hovering a plain row closes any open submenu; a parent row opens its own.
          onHover={() => setOpenIndex(item.submenu?.length ? index : null)}
          onClose={onClose}
        />
      ))}
    </ContextMenu>
  );
}

interface MenuRowProps {
  item: FileMenuItem;
  open: boolean;
  onHover: () => void;
  onClose: () => void;
}

/** One menu row: a leaf action, or a parent that reveals a submenu flyout. */
function MenuRow({ item, open, onHover, onClose }: MenuRowProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const hasSubmenu = !!item.submenu?.length;
  return (
    <>
      <button
        ref={ref}
        type="button"
        role="menuitem"
        aria-haspopup={hasSubmenu ? 'menu' : undefined}
        aria-expanded={hasSubmenu ? open : undefined}
        className={
          'context-menu-item' +
          (item.danger ? ' context-menu-item-danger' : '') +
          (hasSubmenu ? ' context-menu-item-parent' : '')
        }
        onMouseEnter={onHover}
        onFocus={onHover}
        // A parent row keeps the menu open (its flyout carries the actions).
        onClick={
          hasSubmenu
            ? undefined
            : () => {
                onClose();
                item.onClick?.();
              }
        }
      >
        <span className="context-menu-item-label">{item.label}</span>
        {hasSubmenu && <ChevronRightIcon size={14} />}
      </button>
      {hasSubmenu && open && <Submenu anchor={ref} items={item.submenu ?? []} onClose={onClose} />}
    </>
  );
}

interface SubmenuProps {
  /** The parent row the flyout hangs off of. */
  anchor: RefObject<HTMLButtonElement | null>;
  items: FileMenuItem[];
  onClose: () => void;
}

/**
 * A submenu flyout, portaled to <body> so it escapes the parent menu's
 * `backdrop-filter` (which would otherwise make its `position: fixed` resolve
 * against the menu box instead of the viewport). Opens to the right of its
 * anchor, flipping left when the right side would overflow.
 */
function Submenu({ anchor, items, onClose }: SubmenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Start flush with the anchor's right edge; corrected after measuring below.
  const [pos, setPos] = useState(() => {
    const rect = anchor.current?.getBoundingClientRect();
    return { x: rect?.right ?? 0, y: rect?.top ?? 0 };
  });

  useLayoutEffect(() => {
    const btn = anchor.current;
    const el = ref.current;
    if (!btn || !el) return;
    const a = btn.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    // Prefer the right side; flip left when it would spill past the viewport.
    // The 2px overlap keeps the pointer path from the row into the flyout gapless.
    let nx = a.right - 2;
    if (nx + width > window.innerWidth - EDGE_MARGIN) nx = a.left - width + 2;
    nx = Math.max(EDGE_MARGIN, nx);
    // Align the flyout's top with the row, then clamp within the viewport.
    const maxY = window.innerHeight - height - EDGE_MARGIN;
    const ny = Math.max(EDGE_MARGIN, Math.min(a.top - 4, maxY));
    setPos({ x: nx, y: ny });
  }, [anchor, items]);

  return createPortal(
    <div
      ref={ref}
      className="context-menu context-submenu"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (
        <button
          key={`${item.label}-${index}`}
          type="button"
          role="menuitem"
          className={'context-menu-item' + (item.danger ? ' context-menu-item-danger' : '')}
          onClick={() => {
            onClose();
            item.onClick?.();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
