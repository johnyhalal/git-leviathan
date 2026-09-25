import type { IconProps } from './types';

/** Upward chevron (e.g. previous-result affordance). Inherits color via `currentColor`. */
export function ChevronUpIcon({ size = 18 }: IconProps) {
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
      <polyline points="6 15 12 9 18 15" />
    </svg>
  );
}
