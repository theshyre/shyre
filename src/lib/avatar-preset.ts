import { AVATAR_PRESETS, type PresetKey } from "@theshyre/ui";

/**
 * Deterministic fallback color for avatars without a stored `avatar_url`.
 *
 * Hashing on `user_id` (not `display_name`) keeps a person's color stable
 * across renames, i18n'd names, and collisions — same user = same tile on
 * every surface. Without this, every member without a configured avatar
 * shares a single accent color, which defeats identity-at-a-glance in
 * densely authored views like the weekly timesheet.
 *
 * Uses the palette defined in `@theshyre/ui/Avatar` (`AVATAR_PRESETS`). We
 * don't pick a random entry — FNV-1a over the id gives us a stable index
 * into the palette with negligible collision risk at team scale.
 */
export function presetAvatarUrl(userId: string | null | undefined): string | null {
  if (!userId) return null;
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  const idx = hash % AVATAR_PRESETS.length;
  const key: PresetKey = AVATAR_PRESETS[idx]!.key;
  return `preset:${key}`;
}

/**
 * Resolve the avatar URL to display — the caller's stored value when
 * present, otherwise a deterministic preset based on the user_id.
 * Returns null only when we have nothing at all to hash on.
 */
export function resolveAvatarUrl(
  storedUrl: string | null | undefined,
  userId: string | null | undefined,
): string | null {
  if (storedUrl) return storedUrl;
  return presetAvatarUrl(userId);
}
