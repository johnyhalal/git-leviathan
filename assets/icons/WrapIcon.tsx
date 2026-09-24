import type { IconProps } from './types';

/** A line that wraps back under itself — soft word wrap. Inherits `currentColor`. */
export function WrapIcon({ size = 16 }: IconProps) {
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
      <path d="M3 6h18" />
      <path d="M3 12h15a3 3 0 0 1 0 6h-4" />
      <polyline points="16 16 14 18 16 20" />
      <path d="M3 18h7" />
    </svg>
  );
}
