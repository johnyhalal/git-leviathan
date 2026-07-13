import type { IconProps } from './types';

interface StarIconProps extends IconProps {
  /** When true, render a solid star; otherwise just the outline. */
  filled?: boolean;
}

/**
 * Star glyph for favoriting. Outlined by default; `filled` fills it (used to
 * show the yellow starred state, colored via `currentColor` by the caller).
 */
export function StarIcon({ size = 16, filled = false }: StarIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
