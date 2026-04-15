/**
 * Avatar renderer used across the app. Supports:
 *
 *   - Uploaded image (https:// or Supabase-Storage URL)
 *   - Preset tile token of the form `preset:<colorKey>` — renders a colored
 *     circle with the user's initial
 *   - Fallback: accent-colored initial circle (matches existing sidebar)
 *
 * Presets are just strings so we can store them in user_profiles.avatar_url
 * without a schema change.
 */

import type { CSSProperties } from "react";

export const AVATAR_PRESETS = [
  { key: "blue", bg: "#3b82f6", fg: "#ffffff" },
  { key: "violet", bg: "#8b5cf6", fg: "#ffffff" },
  { key: "pink", bg: "#ec4899", fg: "#ffffff" },
  { key: "red", bg: "#ef4444", fg: "#ffffff" },
  { key: "orange", bg: "#f97316", fg: "#ffffff" },
  { key: "amber", bg: "#f59e0b", fg: "#111111" },
  { key: "emerald", bg: "#10b981", fg: "#ffffff" },
  { key: "teal", bg: "#14b8a6", fg: "#ffffff" },
  { key: "slate", bg: "#475569", fg: "#ffffff" },
  { key: "zinc", bg: "#3f3f46", fg: "#ffffff" },
] as const;

export type PresetKey = (typeof AVATAR_PRESETS)[number]["key"];

/**
 * Resolves an avatar_url value:
 *   "preset:blue"     → { kind: "preset", preset: <record> }
 *   "https://..."     → { kind: "image", src: <url> }
 *   null / "" / other → { kind: "initial" }
 */
type Resolved =
  | { kind: "image"; src: string }
  | { kind: "preset"; preset: (typeof AVATAR_PRESETS)[number] }
  | { kind: "initial" };

function resolve(avatarUrl: string | null | undefined): Resolved {
  if (!avatarUrl) return { kind: "initial" };
  if (avatarUrl.startsWith("preset:")) {
    const key = avatarUrl.slice("preset:".length);
    const preset = AVATAR_PRESETS.find((p) => p.key === key);
    if (preset) return { kind: "preset", preset };
    return { kind: "initial" };
  }
  if (avatarUrl.startsWith("http://") || avatarUrl.startsWith("https://")) {
    return { kind: "image", src: avatarUrl };
  }
  return { kind: "initial" };
}

interface Props {
  /** Stored avatar_url value (may be preset:* or a URL or null) */
  avatarUrl: string | null | undefined;
  /** Display name — first letter used for the initial fallback */
  displayName: string;
  /** Pixel size for width/height */
  size?: number;
  /** Optional className for layout (border, ring, etc.) */
  className?: string;
}

export function Avatar({
  avatarUrl,
  displayName,
  size = 36,
  className = "",
}: Props): React.JSX.Element {
  const r = resolve(avatarUrl);
  const initial = (displayName.trim().charAt(0) || "?").toUpperCase();
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(10, Math.floor(size * 0.4)),
  };

  if (r.kind === "image") {
    return (
      <img
        src={r.src}
        alt={displayName}
        width={size}
        height={size}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  if (r.kind === "preset") {
    return (
      <span
        aria-label={displayName}
        className={`inline-flex items-center justify-center rounded-full font-semibold shrink-0 ${className}`}
        style={{ ...style, backgroundColor: r.preset.bg, color: r.preset.fg }}
      >
        {initial}
      </span>
    );
  }

  // Fallback: accent-colored initial
  return (
    <span
      aria-label={displayName}
      className={`inline-flex items-center justify-center rounded-full bg-accent text-content-inverse font-semibold shrink-0 ${className}`}
      style={style}
    >
      {initial}
    </span>
  );
}
