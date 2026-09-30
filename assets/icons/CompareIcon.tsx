import type { IconProps } from './types';

/** Two revisions joined by arrows — comparing them in an external diff/merge tool. Inherits `currentColor`. */
export function CompareIcon({ size = 16 }: IconProps) {
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
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <path d="M11 18H8a2 2 0 0 1-2-2V9" />
      <path d="m15 9-3-3 3-3" />
      <path d="m9 15 3 3-3 3" />
    </svg>
  );
}
