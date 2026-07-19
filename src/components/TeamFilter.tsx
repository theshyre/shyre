"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { FilterChip } from "@/components/FilterChip";
import type { TeamListItem } from "@/lib/team-context";

interface TeamFilterProps {
  teams: TeamListItem[];
  selectedTeamId: string | null;
}

/** Sentinel option key for "All teams" — team ids are UUIDs, so this
 *  can never collide with a real team. */
const ALL_KEY = "__all";

/**
 * Filter pill for list pages, on the shared <FilterChip> scaffold.
 * Shows "All" or the selected org name. Uses URL search param
 * `?org=<id>` so it's page-local. Hidden when user has only 1 org.
 */
export function TeamFilter({
  teams,
  selectedTeamId,
}: TeamFilterProps): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("common.teamFilter");

  const selectedTeam = teams.find((o) => o.id === selectedTeamId);

  // Single team: static pill (no dropdown).
  if (teams.length === 1) {
    const singleOrg = teams[0];
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-inset px-3 py-1 text-caption font-medium text-content-secondary">
        <Building2 size={12} aria-hidden="true" />
        {singleOrg?.name ?? ""}
      </span>
    );
  }

  function pick(key: string): void {
    const params = new URLSearchParams(searchParams.toString());
    // Note: URL param is "org" for legacy reasons — all list pages read
    // from `searchParams.org`. Renaming everywhere would be a coordinated
    // change; for now this writer has to match that reader.
    if (key === ALL_KEY) {
      params.delete("org");
    } else {
      params.set("org", key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <FilterChip
      icon={<Building2 size={12} aria-hidden="true" />}
      dimensionLabel={t("dimension")}
      valueLabel={selectedTeam ? selectedTeam.name : t("all")}
      listboxLabel={t("listboxLabel")}
      customized={Boolean(selectedTeamId)}
      panelClassName="w-[192px]"
      options={[
        {
          key: ALL_KEY,
          label: t("all"),
          selected: !selectedTeamId,
        },
        ...teams.map((org) => ({
          key: org.id,
          label: org.name,
          selected: org.id === selectedTeamId,
        })),
      ]}
      onPick={pick}
    />
  );
}
