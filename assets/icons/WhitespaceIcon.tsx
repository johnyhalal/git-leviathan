import type { IconProps } from './types';

/** A space-bar bracket with arrows at both ends — ignoring leading/trailing whitespace. Inherits `currentColor`. */
export function WhitespaceIcon({ size = 16 }: IconProps) {
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
      <path d="M7 13v3h10v-3" />
      <path d="M2 8h4" />
      <polyline points="4 6 6 8 4 10" />
      <path d="M22 8h-4" />
      <polyline points="20 6 18 8 20 10" />
    </svg>
  );
}
