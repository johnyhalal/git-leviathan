import type { IconProps } from './types';

/** Close / dismiss glyph (×). Inherits color via `currentColor`. */
export function CloseIcon({ size = 12 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="23" y1="1" x2="1" y2="23" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
