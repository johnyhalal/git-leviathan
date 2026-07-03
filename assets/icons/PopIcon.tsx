import type { IconProps } from './types';

/** Pop stash (restore set-aside changes): arrow up out of a tray. Inherits color via `currentColor`. */
export function PopIcon({ size = 18 }: IconProps) {
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
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      <path d="M12 15V3" />
      <polyline points="8 7 12 3 16 7" />
    </svg>
  );
}
