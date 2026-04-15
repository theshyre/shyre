"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Building2, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TeamListItem } from "@/lib/team-context";

interface TeamFilterProps {
  teams: TeamListItem[];
  selectedTeamId: string | null;
}

/**
 * Filter pill for list pages. Shows "All" or selected org name.
 * Uses URL search param `?team=<id>` so it's page-local.
 * Hidden when user has only 1 org.
 */
export function TeamFilter({
  teams,
  selectedTeamId,
}: TeamFilterProps): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedTeam = teams.find((o) => o.id === selectedTeamId);

  // Single org: show as a static pill (no dropdown needed)
  if (teams.length === 1) {
    const singleOrg = teams[0];
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-3 py-1 text-xs font-medium text-content-secondary">
        <Building2 size={12} />
        {singleOrg?.name ?? ""}
      </span>
    );
  }

  const label = selectedTeam ? selectedTeam.name : "All";

  function selectTeam(teamId: string | null): void {
    const params = new URLSearchParams(searchParams.toString());
    if (teamId) {
      params.set("team", teamId);
    } else {
      params.delete("team");
    }
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  // Close on outside click
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          selectedTeamId
            ? "bg-accent-soft text-accent-text"
            : "bg-surface-inset text-content-secondary hover:bg-hover"
        }`}
      >
        <Building2 size={12} />
        {label}
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-48 rounded-lg border border-edge bg-surface-raised shadow-lg overflow-hidden">
          <button
            onClick={() => selectTeam(null)}
            className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors ${
              !selectedTeamId
                ? "bg-accent-soft text-accent-text"
                : "text-content-secondary hover:bg-hover"
            }`}
          >
            All
          </button>
          {teams.map((org) => (
            <button
              key={org.id}
              onClick={() => selectTeam(org.id)}
              className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors ${
                org.id === selectedTeamId
                  ? "bg-accent-soft text-accent-text"
                  : "text-content-secondary hover:bg-hover"
              }`}
            >
              {org.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
