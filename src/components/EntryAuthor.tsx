import { useTranslations } from "next-intl";
import { Avatar, resolveAvatarUrl } from "@theshyre/ui";
import { Tooltip } from "./Tooltip";

export interface EntryAuthorInfo {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface Props {
  author: EntryAuthorInfo | null;
  /** Avatar pixel size. Default 20. */
  size?: number;
  /** If true, only the avatar renders; name surfaces via hover + sr-only. */
  compact?: boolean;
  /** Extra classes for layout hooks. */
  className?: string;
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
 */
export function EntryAuthor({
  author,
  size = 20,
  compact = false,
  className = "",
}: Props): React.JSX.Element {
  const t = useTranslations("common.authorship");
  const name = author?.display_name ?? t("unknownUser");
  const avatarUrl = resolveAvatarUrl(
    author?.avatar_url ?? null,
    author?.user_id ?? null,
  );
  const content = (
    <span
      className={`inline-flex items-center gap-1.5 text-caption text-content-secondary ${className}`}
    >
      <Avatar avatarUrl={avatarUrl} displayName={name} size={size} />
      {compact ? (
        <span className="sr-only">{name}</span>
      ) : (
        <span className="truncate">{name}</span>
      )}
    </span>
  );
  // Compact mode hides the name visually (sr-only keeps it for AT), so
  // sighted hover needs the tooltip to reveal it. Full mode shows the
  // name inline and needs no tooltip.
  if (compact) {
    return <Tooltip label={name}>{content}</Tooltip>;
  }
  return content;
}
