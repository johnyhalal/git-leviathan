import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Delay before a tooltip appears — matches the old CSS `transition-delay`. */
const SHOW_DELAY_MS = 350;
/** Offset from the cursor so the bubble sits just below-right of the pointer. */
const CURSOR_OFFSET_X = 14;
const CURSOR_OFFSET_Y = 18;
/** Gap kept between the bubble and the viewport edge when it has to be nudged in. */
const EDGE_MARGIN = 8;

/** Where the bubble should sit, and whether it was opened by pointer or focus. */
interface Anchor {
  /** The element carrying `data-tooltip`. */
  host: HTMLElement;
  /** Preferred top-left in viewport coords (before edge clamping). */
  x: number;
  y: number;
  /** Focus anchors are centered on the element; pointer anchors track the cursor. */
  centered: boolean;
  /** The current tooltip text (re-read from the host so live labels stay fresh). */
  text: string;
}

/**
 * One global, cursor-following tooltip for the whole app. Instead of a CSS
 * pseudo-element anchored inside each host (which any `overflow` ancestor would
 * clip), a single fixed-position bubble is portaled to `<body>` and positioned
 * at the pointer. Triggered purely by the `data-tooltip` attribute via event
 * delegation, so call sites need no wiring beyond that attribute.
 */
export function TooltipLayer() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  // The bubble renders once at the anchor point, then corrects after measuring.
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const bubbleRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Latest cursor position, so the show-timer can place the bubble where the
  // pointer *is* when it fires, not where it entered.
  const cursor = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const clearTimer = () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      showTimer.current = undefined;
    };
    const hide = () => {
      clearTimer();
      setAnchor(null);
    };

    const hostOf = (node: EventTarget | null): HTMLElement | null => {
      if (!(node instanceof Element)) return null;
      const host = node.closest<HTMLElement>('[data-tooltip]');
      return host && host.getAttribute('data-tooltip') ? host : null;
    };

    const onPointerOver = (event: PointerEvent) => {
      const host = hostOf(event.target);
      if (!host) return;
      cursor.current = { x: event.clientX, y: event.clientY };
      clearTimer();
      showTimer.current = setTimeout(() => {
        const text = host.getAttribute('data-tooltip');
        if (!text) return;
        setAnchor({
          host,
          x: cursor.current.x + CURSOR_OFFSET_X,
          y: cursor.current.y + CURSOR_OFFSET_Y,
          centered: false,
          text,
        });
      }, SHOW_DELAY_MS);
    };

    const onPointerMove = (event: PointerEvent) => {
      cursor.current = { x: event.clientX, y: event.clientY };
      setAnchor((current) => {
        if (!current || current.centered) return current;
        const text = current.host.getAttribute('data-tooltip');
        if (!text) return null;
        return {
          ...current,
          x: event.clientX + CURSOR_OFFSET_X,
          y: event.clientY + CURSOR_OFFSET_Y,
          text,
        };
      });
    };

    const onPointerOut = (event: PointerEvent) => {
      const host = hostOf(event.target);
      if (!host) return;
      // Moving onto a descendant of the same host is not a leave.
      const to = event.relatedTarget;
      if (to instanceof Node && host.contains(to)) return;
      hide();
    };

    const onFocusIn = (event: FocusEvent) => {
      const host = hostOf(event.target);
      if (!host) return;
      const text = host.getAttribute('data-tooltip');
      if (!text) return;
      const rect = host.getBoundingClientRect();
      clearTimer();
      showTimer.current = setTimeout(() => {
        setAnchor({
          host,
          x: rect.left + rect.width / 2,
          y: rect.bottom + CURSOR_OFFSET_Y,
          centered: true,
          text,
        });
      }, SHOW_DELAY_MS);
    };

    const onFocusOut = (event: FocusEvent) => {
      if (hostOf(event.target)) hide();
    };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    // Capture so a scroll in any nested container dismisses (the bubble is fixed
    // and would otherwise hang detached from its host).
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      clearTimer();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Measure the bubble and nudge it in so it never spills past a viewport edge,
  // flipping to the other side of the anchor when it would overflow.
  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!anchor || !el) return;
    const { width, height } = el.getBoundingClientRect();
    let x = anchor.x;
    let y = anchor.y;
    if (anchor.centered) x -= width / 2;
    // Flip to the other side of the cursor/anchor before clamping, so the bubble
    // doesn't cover the pointer when it's near the right/bottom edge.
    if (x + width > window.innerWidth - EDGE_MARGIN) {
      x = anchor.centered ? x : anchor.x - width - CURSOR_OFFSET_X;
    }
    if (y + height > window.innerHeight - EDGE_MARGIN) {
      y = anchor.y - height - CURSOR_OFFSET_Y;
    }
    x = Math.max(EDGE_MARGIN, Math.min(x, window.innerWidth - width - EDGE_MARGIN));
    y = Math.max(EDGE_MARGIN, Math.min(y, window.innerHeight - height - EDGE_MARGIN));
    setPos({ x, y });
  }, [anchor]);

  if (!anchor) return null;

  return createPortal(
    <div
      ref={bubbleRef}
      className="tooltip-bubble"
      role="tooltip"
      style={{ left: pos.x, top: pos.y }}
    >
      {anchor.text}
    </div>,
    document.body,
  );
}
