import type { IconProps } from './types';

/** A pane divided into two columns of lines — the side-by-side diff. Inherits `currentColor`. */
export function SplitViewIcon({ size = 16 }: IconProps) {
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
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
      <path d="M6 9h3" />
      <path d="M6 13h3" />
      <path d="M15 9h3" />
      <path d="M15 13h3" />
    </svg>
  );
}
