import { useTranslations } from "next-intl";
import { Bot } from "lucide-react";
import { Avatar, resolveAvatarUrl } from "@theshyre/ui";
import { Tooltip } from "./Tooltip";

export interface EntryAuthorInfo {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

/** `time_entries.started_by_kind` values that earn the agent badge.
 *  'user' and 'import' render as plain human authorship — imports are
 *  historical data the human already owns, not live automation. */
const BADGED_KINDS = new Set(["agent", "integration"]);

interface Props {
  author: EntryAuthorInfo | null;
  /** Avatar pixel size. Default 20. */
  size?: number;
  /** If true, only the avatar renders; name surfaces via hover + sr-only. */
  compact?: boolean;
  /** Extra classes for layout hooks. */
  className?: string;
  /** `time_entries.started_by_kind` — who/what initiated the entry
   *  ('user' | 'agent' | 'integration' | 'import'). Display-only:
   *  'agent' / 'integration' add a Bot badge; anything else (or
   *  undefined, for surfaces whose query doesn't select the column)
   *  renders plain human authorship. */
  startedByKind?: string | null;
  /** `time_entries.agent_label` — e.g. "Claude Code". Falls back to a
   *  generic localized label when the row carries none. */
  agentLabel?: string | null;
  /** True when this chip represents a ROLLUP of several entries
   *  (merged title line, weekly aggregate row, drawer header) rather
   *  than a single entry. Switches the tooltip sentence from
   *  "Started by X on behalf of Y" to "Includes time started by X" so
   *  a row where only some entries are agent-started never overstates
   *  the attribution. */
  rollup?: boolean;
}

/**
 * Renders the author of a time entry — avatar + display name — per the
 * mandatory authorship rule in CLAUDE.md. Use on every surface that
 * surfaces a `time_entries` row (list, card, table row, invoice line
 * item, trash view).
 *
 * A null author renders an unknown placeholder rather than omitting the
 * slot, so the layout is predictable. When `avatar_url` isn't stored,
 * the tile color is deterministically derived from `user_id` so the
 * same person gets the same color everywhere.
 *
 * Agent attribution (SAL-051 / multi-stream-timers Option B Phase 1):
 * when the entry was started by an agent or integration, the chip gains
 * a Bot badge. The human stays the author — the badge is an additive
 * "via Claude Code" annotation, never a replacement for the avatar +
 * name. Two channels always (icon + text): full mode shows the Bot
 * glyph plus visible "via {label}" text; compact mode shows the glyph
 * with sr-only text and folds the full sentence into the hover tooltip.
 */
export function EntryAuthor({
  author,
  size = 20,
  compact = false,
  className = "",
  startedByKind,
  agentLabel,
  rollup = false,
}: Props): React.JSX.Element {
  const t = useTranslations("common.authorship");
  const name = author?.display_name ?? t("unknownUser");
  const avatarUrl = resolveAvatarUrl(
    author?.avatar_url ?? null,
    author?.user_id ?? null,
  );

  const badged = startedByKind != null && BADGED_KINDS.has(startedByKind);
  const label = badged
    ? (agentLabel ??
      t(
        startedByKind === "integration"
          ? "integrationFallback"
          : "agentFallback",
      ))
    : null;
  const badgeSentence =
    badged && label !== null
      ? rollup
        ? t("includesAgentTime", { label })
        : t("startedByOnBehalf", { label, name })
      : null;

  const badge =
    badged && label !== null ? (
      <span className="inline-flex items-center gap-1 text-caption text-content-muted">
        <Bot size={Math.min(size, 14)} aria-hidden="true" className="shrink-0" />
        {compact ? (
          <span className="sr-only">{t("viaAgent", { label })}</span>
        ) : (
          <span className="truncate">{t("viaAgent", { label })}</span>
        )}
      </span>
    ) : null;

  const content = (
    // min-w-0 + max-w-full so the inner `truncate` spans can actually
    // ellipsize when the chip is a flex child (sidebar timer) or sits
    // in a width-constrained column (week grid) — an inline-flex box's
    // automatic minimum size is otherwise its max-content width and
    // long name + "via {label}" combos would overflow, not truncate.
    <span
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 text-caption text-content-secondary ${className}`}
    >
      <Avatar avatarUrl={avatarUrl} displayName={name} size={size} />
      {compact ? (
        <span className="sr-only">{name}</span>
      ) : (
        // labelMode="label" (not the default "describe") — the span's
        // own accessible name would otherwise come from its text
        // content, which is this same string, and "describe" mode
        // would add an identical aria-describedby on top of it
        // (double-announce). Same pattern as expense-row's truncated
        // team-name cell. Hover-only, matching that precedent — the
        // span isn't a focus target.
        <Tooltip label={name} labelMode="label">
          <span className="truncate">{name}</span>
        </Tooltip>
      )}
      {compact ? (
        badge
      ) : badge && badgeSentence ? (
        // Full mode: the "via {label}" text is visible; the tooltip adds
        // the who-on-behalf-of-whom sentence for hover/focus context.
        <Tooltip label={badgeSentence}>{badge}</Tooltip>
      ) : null}
    </span>
  );
  // Compact mode hides the name visually (sr-only keeps it for AT), so
  // sighted hover needs the tooltip to reveal it. Full mode shows the
  // name inline and needs no tooltip. Agent-started compact chips fold
  // the attribution into the same tooltip ("Started by X on behalf of
  // Y") so dense surfaces stay one hover target.
  //
  // Known, accepted gap (a11y review 2026-07-17): the compact chip is a
  // non-interactive span, so keyboard-only and touch users can't open
  // this tooltip — same pre-existing tradeoff as the name-on-hover
  // pattern itself. Screen readers get the sr-only name + badge text,
  // and the full sentence is always visible on the entry's edit form.
  if (compact) {
    return <Tooltip label={badgeSentence ?? name}>{content}</Tooltip>;
  }
  return content;
}
