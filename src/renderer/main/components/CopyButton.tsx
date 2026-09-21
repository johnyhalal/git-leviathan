import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from '../../../../assets/icons';

/** How long the "copied" checkmark shows before the icon reverts. */
const COPIED_MS = 1500;

/**
 * Copy-to-clipboard with a brief confirmation: `copy(text)` writes the text
 * and flips `copied` on for {@link COPIED_MS}. Timers are cleared on unmount so
 * a fast close can't set state on a gone component.
 */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    });
  }, []);
  return { copied, copy };
}

interface CopyButtonProps {
  /** The text written to the clipboard on click. */
  text: string;
  /** What's being copied, for the tooltip/label: "Copy <what>". */
  what: string;
  size?: number;
  className?: string;
}

/**
 * A subtle icon button that copies `text` and turns into a green checkmark for
 * a moment. It's hidden until hovered — wrap it and the thing it copies in an
 * element with the `copy-host` class, which reveals the button on hover (it's
 * always shown while keyboard-focused). Clicks don't propagate, so it can sit
 * inside a clickable row.
 */
export function CopyButton({ text, what, size = 13, className }: CopyButtonProps) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      className={`copy-btn tooltip-host${copied ? ' is-copied' : ''}${className ? ` ${className}` : ''}`}
      data-tooltip={copied ? 'Copied' : `Copy ${what}`}
      aria-label={`Copy ${what}`}
      onClick={(event) => {
        event.stopPropagation();
        copy(text);
      }}
    >
      {copied ? <CheckIcon size={size} /> : <CopyIcon size={size} />}
    </button>
  );
}
