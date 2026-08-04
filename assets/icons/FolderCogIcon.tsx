import type { IconProps } from './types';

/**
 * Folder with a cog in its lower-right corner — the per-repository settings
 * glyph, deliberately distinct from the plain settings {@link GearIcon}.
 * Inherits color via `currentColor`.
 */
export function FolderCogIcon({ size = 18 }: IconProps) {
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
      <path d="M10.3 20H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.9c.7 0 1.3.3 1.7.9l.8 1.2c.4.6 1 .9 1.7.9H20a2 2 0 0 1 2 2v3.3" />
      <circle cx="18" cy="18" r="3.4" />
      <path d="M22.3 18h1.1" />
      <path d="M12.6 18h1.1" />
      <path d="M18 22.3v1.1" />
      <path d="M18 12.6v1.1" />
      <path d="m21 21 .8.8" />
      <path d="m14.2 14.2.8.8" />
      <path d="m15 21-.8.8" />
      <path d="m21.8 14.2-.8.8" />
    </svg>
  );
}
