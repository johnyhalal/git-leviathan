import type { IconProps } from './types';

/** A column of lines with a + and − marker — the whole-file inline diff. Inherits `currentColor`. */
export function InlineViewIcon({ size = 16 }: IconProps) {
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
      <path d="M10 5h10" />
      <path d="M10 10h10" />
      <path d="M10 15h10" />
      <path d="M10 20h10" />
      <path d="M3 10h4" />
      <path d="M5 8v4" />
      <path d="M3 15h4" />
    </svg>
  );
}
