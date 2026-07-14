import { useEffect, type ReactNode } from 'react';

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
        className="context-menu"
        role="menu"
        style={{ left: x, top: y }}
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
