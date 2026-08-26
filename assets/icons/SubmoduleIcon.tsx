import type { IconProps } from './types';

/** A box nested inside a larger dashed box — a repository embedded in another —
 * marking a git submodule. Inherits `currentColor`. */
export function SubmoduleIcon({ size = 16 }: IconProps) {
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
      <path d="M3 8V5a2 2 0 0 1 2-2h3" strokeDasharray="0 0" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <rect x="8" y="8" width="8" height="8" rx="1.5" />
    </svg>
  );
}
