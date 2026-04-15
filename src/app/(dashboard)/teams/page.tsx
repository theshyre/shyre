import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Building2, Crown, ShieldCheck, User } from "lucide-react";
import { NewTeamForm } from "./new-team-form";

export default async function OrganizationsPage(): Promise<React.JSX.Element> {
  const teams = await getUserTeams();
  const tc = await getTranslations("common");

  const roleIcons: Record<string, typeof Crown> = {
    owner: Crown,
    admin: ShieldCheck,
    member: User,
  };

  const roleColors: Record<string, string> = {
    owner: "text-warning bg-warning-soft",
    admin: "text-accent bg-accent-soft",
    member: "text-content-muted bg-surface-inset",
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 size={24} className="text-accent" />
          <h1 className="text-2xl font-bold text-content">
            {tc("nav.teams")}
          </h1>
        </div>
      </div>

      <NewTeamForm />

      <div className="mt-6 space-y-3">
        {teams.map((org) => {
          const RoleIcon = roleIcons[org.role] ?? User;
          const roleColor = roleColors[org.role] ?? roleColors.member;
          return (
            <Link
              key={org.id}
              href={`/teams/${org.id}`}
              className="flex items-center justify-between rounded-lg border border-edge bg-surface-raised px-5 py-4 hover:bg-hover transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft">
                  <Building2 size={20} className="text-accent" />
                </div>
                <div>
                  <p className="font-medium text-content">{org.name}</p>
                  <p className="text-xs text-content-muted">{org.slug}</p>
                </div>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${roleColor}`}
              >
                <RoleIcon size={12} />
                {org.role}
              </span>
            </Link>
          );
        })}

        {teams.length === 0 && (
          <p className="text-sm text-content-muted">
            No teams yet. Create one to get started.
          </p>
        )}
      </div>
    </div>
  );
}
