import type { IconProps } from './types';

/**
 * Gitflow: two parallel branch lines (main / develop) with a topic branch
 * forking off and merging back. Inherits color via `currentColor`.
 */
export function GitflowIcon({ size = 18 }: IconProps) {
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
      <line x1="6" y1="3" x2="6" y2="21" />
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="12" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <path d="M8 7.5c6 1 8 2.5 8 4.5s-2 3.5-8 4.5" />
    </svg>
  );
}
