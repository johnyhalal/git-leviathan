import { useEffect, useRef } from 'react';

/**
 * Returns a ref to attach to a widget's root; while `open`, a pointer-down or
 * Escape outside/inside the widget calls `onDismiss`. Mirrors the close
 * behaviour used by the clone dialog's combobox.
 */
export function useOutsideDismiss<T extends HTMLElement>(
  open: boolean,
  onDismiss: () => void,
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onDismiss]);

  return ref;
}
