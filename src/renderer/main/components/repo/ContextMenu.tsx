import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Gap kept between the menu and the viewport edge when it has to be nudged in. */
const EDGE_MARGIN = 8;

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
