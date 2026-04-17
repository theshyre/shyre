import { Avatar } from "@theshyre/ui";

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
 * slot, so the layout is predictable.
 */
export function EntryAuthor({
  author,
  size = 20,
  compact = false,
  className = "",
}: Props): React.JSX.Element {
  const name = author?.display_name ?? "Unknown user";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-caption text-content-secondary ${className}`}
      title={compact ? name : undefined}
    >
      <Avatar
        avatarUrl={author?.avatar_url ?? null}
        displayName={name}
        size={size}
      />
      {compact ? (
        <span className="sr-only">{name}</span>
      ) : (
        <span className="truncate">{name}</span>
      )}
    </span>
  );
}
