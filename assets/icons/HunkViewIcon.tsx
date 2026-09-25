import type { IconProps } from './types';

/** Two separated blocks of lines — the diff's hunk-only view. Inherits `currentColor`. */
export function HunkViewIcon({ size = 16 }: IconProps) {
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
      <path d="M4 4h16" />
      <path d="M4 8h11" />
      <path d="M4 12h1.5" />
      <path d="M9.25 12h1.5" />
      <path d="M14.5 12h1.5" />
      <path d="M19.75 12h.25" />
      <path d="M4 16h16" />
      <path d="M4 20h13" />
    </svg>
  );
}
