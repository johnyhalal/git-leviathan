/**
 * Deterministic per-author colors for the blame gutter and the file-history
 * timeline. The hue is derived from the author's identity (their email, falling
 * back to their name) so the same person always gets the same color across
 * files and sessions; saturation and lightness are fixed to values legible on
 * both the light and dark themes.
 *
 * `accent` is opaque, for the author dot and the commit hash text; `tint` is
 * translucent so it composites over either theme's surface as a row background.
 */
export interface AuthorColor {
  accent: string;
  tint: string;
}

/** A stable, well-spread hue (0–359) from an identity string. */
function hueFor(identity: string): number {
  let hash = 0;
  for (let i = 0; i < identity.length; i++) {
    // A cheap string hash (djb2-ish, kept in 32-bit range).
    hash = (Math.imul(hash, 31) + identity.charCodeAt(i)) | 0;
  }
  // Multiply into the hue circle so near-identical identities land far apart.
  return Math.abs(hash * 47) % 360;
}

const cache = new Map<string, AuthorColor>();

/**
 * The color for an author, keyed on their identity (email preferred, name as a
 * fallback). Results are memoized so a file's many blame lines don't recompute.
 */
export function authorColor(email: string, name: string): AuthorColor {
  const key = (email || name).trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const hue = hueFor(key);
  const color: AuthorColor = {
    accent: `hsl(${hue} 62% 52%)`,
    tint: `hsl(${hue} 62% 52% / 0.14)`,
  };
  cache.set(key, color);
  return color;
}
