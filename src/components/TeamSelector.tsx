"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { selectClass, inputClass, labelClass } from "@/lib/form-styles";
import type { TeamListItem } from "@/lib/team-context";

interface TeamSelectorProps {
  teams: TeamListItem[];
  label?: string;
  /** Pre-select this org (e.g., from current page filter) */
  defaultTeamId?: string | null;
}

const LAST_TEAM_KEY = "stint-last-team";

/**
 * Org selector for create forms.
 * Always visible — shows the org name even when there's only one.
 */
export function TeamSelector({
  teams,
  label,
  defaultTeamId,
}: TeamSelectorProps): React.JSX.Element | null {
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");

  useEffect(() => {
    if (teams.length === 0) return;

    // Priority: explicit default > last-used > first org
    if (defaultTeamId && teams.some((o) => o.id === defaultTeamId)) {
      setSelectedTeamId(defaultTeamId);
      return;
    }

    const lastTeam = localStorage.getItem(LAST_TEAM_KEY);
    const validLast = lastTeam && teams.some((o) => o.id === lastTeam);

    if (validLast) {
      setSelectedTeamId(lastTeam);
    } else {
      const firstTeam = teams[0];
      if (firstTeam) {
        setSelectedTeamId(firstTeam.id);
      }
    }
  }, [teams, defaultTeamId]);

  if (teams.length === 0) return null;

  // Single org: show as read-only so user always sees where data goes
  if (teams.length === 1) {
    const singleOrg = teams[0];
    return (
      <div>
        <label className={labelClass}>
          <span className="inline-flex items-center gap-1.5">
            <Building2 size={14} className="text-accent" />
            {label ?? "Team"}
          </span>
        </label>
        <input
          type="text"
          value={singleOrg?.name ?? ""}
          disabled
          className={inputClass}
        />
        <input
          type="hidden"
          name="team_id"
          value={singleOrg?.id ?? ""}
        />
      </div>
    );
  }

  // Multiple teams: dropdown
  return (
    <div>
      <label className={labelClass}>
        <span className="inline-flex items-center gap-1.5">
          <Building2 size={14} className="text-accent" />
          {label ?? "Team"}
        </span>
      </label>
      <select
        name="team_id"
        required
        value={selectedTeamId}
        onChange={(e) => {
          setSelectedTeamId(e.target.value);
          localStorage.setItem(LAST_TEAM_KEY, e.target.value);
        }}
        className={selectClass}
      >
        {teams.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Call after successful form submission to remember the last-used org.
 */
export function updateLastOrg(teamId: string): void {
  localStorage.setItem(LAST_TEAM_KEY, teamId);
}
