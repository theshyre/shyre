/**
 * Square "identity chip" for a customer. Renders 2-letter initials
 * on a deterministic background drawn from the same `AVATAR_PRESETS`
 * palette that `@theshyre/ui`'s `<Avatar>` uses for people. Shape
 * (square) and content (2 letters vs. 1) disambiguate it from a
 * member avatar at any size — important since both can appear on
 * the same row in densely authored views.
 *
 * Persona-converged design (UX + agency + solo + a11y, 2026-05-11):
 *   - Shared palette with Avatar keeps Shyre's identity language
 *     coherent and reuses the CVD-vetted color set.
 *   - Square shape distinguishes "organization" from "person".
 *   - Hash key is the customer id (NOT the name), so renames are
 *     stable and two customers with the same name don't collide.
 *   - `aria-hidden` — the adjacent customer-name text is the
 *     accessible name. Screen readers never speak "EC" as the
 *     customer's identity.
 *
 * Authored locally per the `DateField` precedent. Intended for
 * promotion to `@theshyre/ui` once Liv adopts it, alongside a
 * possible `<EntityChip>` generalization.
 */

import type { CSSProperties } from "react";
import { Building2 } from "lucide-react";
import { AVATAR_PRESETS, presetAvatarUrl } from "@theshyre/ui";

interface Props {
  /** Stable customer id — drives the deterministic color slot.
   *  Hash on id (not name) so renames don't shift the color. */
  customerId: string | null | undefined;
  /** Customer name — used only to derive the visible initials.
   *  The accessible name is provided by the sibling text node;
   *  this chip is `aria-hidden`. */
  customerName: string | null | undefined;
  /** When true, the chip renders the "internal project" treatment
   *  (Building glyph on a neutral background) instead of the
   *  question-mark "missing customer" fallback. Internal projects
   *  don't have a customer by design — surfacing them with the
   *  same `?` we use for missing data reads as broken. */
  internal?: boolean;
  /** Pixel size. Default 16 for compact list contexts. */
  size?: number;
  /** Optional className for layout adjustments (margin, etc.). */
  className?: string;
}

/**
 * 2-letter initials from a customer name. First letter of the first
 * two whitespace-separated tokens, stripped of surrounding
 * punctuation. Falls back to the first two letters of a single-word
 * name, and to "?" when the name is empty.
 *
 *   "EyeReg Consulting, Inc."  → "EC"
 *   "Pierce Clark & Associates" → "PC"
 *   "Acme"                      → "AC"
 *   ""                          → "?"
 *
 * Initials collisions ("Atlas Corp" / "Acme Co" both → "AC") are
 * acceptable — sighted users get the background color as a second
 * channel, and the chip is always paired with the full name text.
 */
export function customerInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const cleaned = name.trim();
  if (cleaned === "") return "?";
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return "?";
  if (tokens.length === 1) {
    const t = tokens[0]!;
    return (t.charAt(0) + (t.charAt(1) || "")).toUpperCase();
  }
  return (tokens[0]!.charAt(0) + tokens[1]!.charAt(0)).toUpperCase();
}

/**
 * Resolve the customer id to a preset entry from `AVATAR_PRESETS`.
 * Returns the first slate slot when the id is missing — the chip
 * still renders, just without the per-customer color signal.
 */
function presetForCustomerId(
  customerId: string | null | undefined,
): (typeof AVATAR_PRESETS)[number] {
  const url = presetAvatarUrl(customerId);
  if (url) {
    const key = url.slice("preset:".length);
    const found = AVATAR_PRESETS.find((p) => p.key === key);
    if (found) return found;
  }
  // Fallback when there's nothing to hash — the slate preset is
  // visually quiet and signals "no specific customer."
  return AVATAR_PRESETS.find((p) => p.key === "slate") ?? AVATAR_PRESETS[0]!;
}

/**
 * Public helper — the customer's hashed background color, suitable
 * for rails / connectors that need to match the CustomerChip
 * visually. Same palette + hash, so a customer's chip and any
 * adjacent rail render in lock-step. Returns null for the
 * internal-project and no-customer cases — callers decide whether
 * to render a neutral rail or no rail at all.
 */
export function customerRailColor(
  customerId: string | null | undefined,
): string | null {
  if (!customerId) return null;
  return presetForCustomerId(customerId).bg;
}

export function CustomerChip({
  customerId,
  customerName,
  internal = false,
  size = 16,
  className = "",
}: Props): React.JSX.Element {
  // Internal-project branch: the project intentionally has no
  // customer. Render a building glyph on a neutral background to
  // signal "internal work," not the `?` we use for missing data.
  if (internal && !customerId) {
    const style: CSSProperties = {
      width: size,
      height: size,
      backgroundColor: "var(--surface-inset, #e5e7eb)",
      color: "var(--content-secondary, #4b5563)",
    };
    return (
      <span
        aria-hidden="true"
        className={`inline-flex items-center justify-center rounded-[3px] shrink-0 border border-edge/60 ${className}`}
        style={style}
      >
        <Building2 size={Math.max(10, Math.floor(size * 0.66))} />
      </span>
    );
  }

  const initials = customerInitials(customerName);
  const preset = presetForCustomerId(customerId);
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(8, Math.floor(size * 0.55)),
    backgroundColor: preset.bg,
    color: preset.fg,
  };
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center rounded-[3px] font-semibold font-mono leading-none shrink-0 ${className}`}
      style={style}
    >
      {initials}
    </span>
  );
}
