import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronRightIcon } from '../../../../../assets/icons';

/** Gap kept between the menu (or a submenu flyout) and the viewport edge. */
const EDGE_MARGIN = 8;

/** One row in a right-click menu: a leaf action, or a parent opening a submenu. */
export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  /** Runs when the row is chosen. Omit for a parent row that only opens a submenu. */
  onClick?: () => void;
  /** Nested rows; when present the row opens a flyout instead of acting on click. */
  submenu?: ContextMenuItem[];
}

/** A menu row or a divider between action groups. */
export type ContextMenuEntry = ContextMenuItem | 'separator';

interface ContextMenuProps {
  /** Viewport coordinates to anchor the menu at (the right-click point). */
  x: number;
  y: number;
  /** Dismiss the menu (click on the scrim, Escape, or after an item runs). */
  onClose: () => void;
  /** The menu items. */
  children: ReactNode;
}

/**
 * Shared shell for right-click menus: a menu positioned at (x, y) over a
 * full-screen invisible scrim. While open the scrim swallows background clicks
 * (any click on it closes the menu) and scrolling is locked everywhere, so the
 * menu can never drift away from the point it was anchored to. Escape also closes.
 */
export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Start at the click point, then nudge in after measuring so the menu never
  // spills past a viewport edge (it renders once at (x, y), then corrects).
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const maxX = window.innerWidth - width - EDGE_MARGIN;
    const maxY = window.innerHeight - height - EDGE_MARGIN;
    // Clamp within [EDGE_MARGIN, max]; max can go below the margin on a tiny
    // window, so the lower bound wins to keep the top-left corner on screen.
    setPos({
      x: Math.max(EDGE_MARGIN, Math.min(x, maxX)),
      y: Math.max(EDGE_MARGIN, Math.min(y, maxY)),
    });
  }, [x, y]);

  useEffect(() => {
    // React registers wheel/touch listeners as passive, so `preventDefault` in a
    // React handler is a no-op — block scrolling with native non-passive ones.
    const blockScroll = (event: Event) => event.preventDefault();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('wheel', blockScroll, { passive: false });
    document.addEventListener('touchmove', blockScroll, { passive: false });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('wheel', blockScroll);
      document.removeEventListener('touchmove', blockScroll);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="context-menu-overlay"
      // A press anywhere on the scrim (i.e. outside the menu) closes it.
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className="context-menu"
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        // Keep clicks inside the menu from reaching the scrim (which would close
        // it before the item's own handler runs) and suppress the native menu.
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {children}
      </div>
    </div>
  );
}

interface MenuRowProps {
  item: ContextMenuItem;
  /** Whether this row's submenu flyout is the open one. */
  open: boolean;
  /** Hovered/focused — the owning menu decides which flyout that opens (if any). */
  onHover: () => void;
  onClose: () => void;
}

/**
 * One menu row: a leaf action, or a parent that reveals a submenu flyout. The
 * open row is tracked by the owning menu (only one flyout at a time), which is
 * why `open`/`onHover` come in from outside rather than living here.
 */
export function MenuRow({ item, open, onHover, onClose }: MenuRowProps) {
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
  items: ContextMenuItem[];
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
