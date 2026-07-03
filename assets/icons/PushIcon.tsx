import type { IconProps } from './types';

/** Push (upload to remote): arrow up from a baseline. Inherits color via `currentColor`. */
export function PushIcon({ size = 18 }: IconProps) {
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
      <path d="M5 3h14" />
      <path d="M12 21V9" />
      <polyline points="7 14 12 9 17 14" />
    </svg>
  );
}
