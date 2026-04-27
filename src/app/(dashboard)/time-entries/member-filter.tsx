"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Users, ChevronDown, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Avatar, resolveAvatarUrl } from "@theshyre/ui";

export interface MemberOption {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  /** True for the caller's own membership. */
  isSelf: boolean;
}

interface Props {
  /** Ordered list of team members the caller can potentially view. */
  members: MemberOption[];
  /** Current selection parsed from the URL — "me" | "all" | list of user_ids. */
  selection: "me" | "all" | string[];
}

/**
 * Filter pill for the /time-entries page controlling whose entries are
 * visible. Defaults to "me" so a team member sees only their own on load
 * and has to explicitly opt into seeing others. Options:
 *
 *   - "You" (me — default)
 *   - "All team"
 *   - Any combination of individual members
 *
 * Serializes to `?members=me` (default, may also be omitted) | `?members=all`
 * | `?members=u1,u2,u3`. Server parses in /time-entries/page.tsx.
 *
 * Always rendered, even on a solo team — the control is part of the page's
 * permanent toolbar so it doesn't suddenly appear when a second member joins.
 * Authorship (the avatar in row groupings) is a separate signal from filter
 * state, so a solo viewer still benefits from seeing the "You" pill as
 * confirmation of what they're scoped to.
 */
export function MemberFilter({
  members,
  selection,
}: Props): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useTranslations("time.memberFilter");

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (members.length === 0) return null;

  function pushSelection(next: "me" | "all" | string[]): void {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "me") {
      params.delete("members");
    } else if (next === "all") {
      params.set("members", "all");
    } else if (next.length === 0) {
      // Empty list == no entries; represent as a special "none" value so the
      // URL is unambiguous. Server treats as "filter to no one" (shows blank).
      params.set("members", "none");
    } else {
      params.set("members", next.join(","));
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function label(): string {
    if (selection === "me") return t("justYou");
    if (selection === "all") return t("allTeam", { count: members.length });
    // Custom list.
    if (selection.length === 0) return t("none");
    if (selection.length === 1) {
      const only = members.find((m) => m.user_id === selection[0]);
      return only?.isSelf
        ? t("justYou")
        : (only?.display_name ?? t("unknownMember"));
    }
    const includesSelf = selection.some(
      (id) => members.find((m) => m.user_id === id)?.isSelf,
    );
    if (includesSelf) {
      return t("youPlus", { count: selection.length - 1 });
    }
    return t("nMembers", { count: selection.length });
  }

  function isChecked(userId: string): boolean {
    if (selection === "all") return true;
    if (selection === "me") {
      return !!members.find((m) => m.user_id === userId)?.isSelf;
    }
    return selection.includes(userId);
  }

  function toggleMember(userId: string): void {
    const currentIds: string[] =
      selection === "all"
        ? members.map((m) => m.user_id)
        : selection === "me"
          ? members.filter((m) => m.isSelf).map((m) => m.user_id)
          : [...selection];
    const idx = currentIds.indexOf(userId);
    if (idx === -1) {
      currentIds.push(userId);
    } else {
      currentIds.splice(idx, 1);
    }
    // Collapse to the canonical values when the selection matches them.
    if (currentIds.length === members.length) {
      pushSelection("all");
      return;
    }
    const selfIds = members.filter((m) => m.isSelf).map((m) => m.user_id);
    if (
      currentIds.length === selfIds.length &&
      currentIds.every((id) => selfIds.includes(id))
    ) {
      pushSelection("me");
      return;
    }
    pushSelection(currentIds);
  }

  const hasSelfExactly = selection === "me";
  const hasAll = selection === "all";
  const selectionActive = !hasSelfExactly;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-medium transition-colors ${
          selectionActive
            ? "bg-accent-soft text-accent-text border border-accent/30"
            : "bg-surface-inset text-content-secondary border border-edge hover:bg-hover"
        }`}
      >
        <Users size={12} />
        {label()}
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[256px] rounded-lg border border-edge bg-surface-raised shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={() => {
              pushSelection("me");
              setOpen(false);
            }}
            className={`flex items-center gap-2 w-full px-3 py-2 text-body text-left transition-colors border-b border-edge ${
              hasSelfExactly
                ? "bg-accent-soft text-accent-text"
                : "text-content-secondary hover:bg-hover"
            }`}
          >
            <Users size={14} />
            <span className="flex-1">{t("justYou")}</span>
            {hasSelfExactly && <Check size={14} />}
          </button>

          <button
            type="button"
            onClick={() => {
              pushSelection("all");
              setOpen(false);
            }}
            className={`flex items-center gap-2 w-full px-3 py-2 text-body text-left transition-colors border-b border-edge ${
              hasAll
                ? "bg-accent-soft text-accent-text"
                : "text-content-secondary hover:bg-hover"
            }`}
          >
            <Users size={14} />
            <span className="flex-1">
              {t("allTeam", { count: members.length })}
            </span>
            {hasAll && <Check size={14} />}
          </button>

          <div className="max-h-[240px] overflow-y-auto">
            {members.map((m) => {
              const checked = isChecked(m.user_id);
              return (
                <button
                  key={m.user_id}
                  type="button"
                  onClick={() => toggleMember(m.user_id)}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-body text-left transition-colors ${
                    checked
                      ? "bg-accent-soft/50 text-content"
                      : "text-content-secondary hover:bg-hover"
                  }`}
                >
                  <Avatar
                    avatarUrl={resolveAvatarUrl(m.avatar_url, m.user_id)}
                    displayName={m.display_name ?? t("unknownMember")}
                    size={20}
                  />
                  <span className="flex-1 truncate">
                    {m.display_name ?? t("unknownMember")}
                    {m.isSelf && (
                      <span className="text-content-muted text-caption">
                        {" "}· {t("youSuffix")}
                      </span>
                    )}
                  </span>
                  {checked && <Check size={14} className="text-accent" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
