"use client";

import { useTranslations } from "next-intl";
import type { ProjectOption } from "./types";

interface Props {
  projects: ProjectOption[];
  selectedId: string;
  onPick: (id: string) => void;
}

export function RecentProjectsChips({
  projects,
  selectedId,
  onPick,
}: Props): React.JSX.Element {
  const th = useTranslations("time.home");
  return (
    <div>
      <p className="mb-2 text-caption font-semibold uppercase tracking-wider text-content-muted">
        {th("recentProjects")}
      </p>
      <div className="flex flex-wrap gap-2">
        {projects.map((p) => {
          const active = p.id === selectedId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.id)}
              className={`rounded-full px-3 py-1 text-caption font-medium transition-colors ${
                active
                  ? "bg-accent-soft text-accent-text"
                  : "bg-surface-inset text-content-secondary hover:bg-hover"
              }`}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
