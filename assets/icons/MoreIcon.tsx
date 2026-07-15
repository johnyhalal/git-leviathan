import type { IconProps } from './types';

/** Vertical three-dot "more options" glyph — opens a row's context menu. Inherits `currentColor`. */
export function MoreIcon({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="3" r="2.6" />
      <circle cx="12" cy="12" r="2.6" />
      <circle cx="12" cy="21" r="2.6" />
    </svg>
  );
}
