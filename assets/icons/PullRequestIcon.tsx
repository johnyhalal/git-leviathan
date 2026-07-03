import type { IconProps } from './types';

/** Pull request: a branch line merging toward a target node. Inherits color via `currentColor`. */
export function PullRequestIcon({ size = 18 }: IconProps) {
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
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="6" y1="9" x2="6" y2="15" />
      <circle cx="18" cy="18" r="3" />
      <path d="M18 15V9a3 3 0 0 0-3-3h-3" />
      <polyline points="15 3 12 6 15 9" />
    </svg>
  );
}
