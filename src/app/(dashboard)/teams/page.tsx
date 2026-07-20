import type { Metadata } from "next";
import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Building2, Crown, ShieldCheck, User } from "lucide-react";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { AddTeamTrigger, NewTeamForm, NewTeamFormProvider } from "./new-team-form";

export async function generateMetadata(): Promise<Metadata> {
  const tc = await getTranslations("common.nav");
  return { title: tc("teams") };
}

export default async function OrganizationsPage(): Promise<React.JSX.Element> {
  const teams = await getUserTeams();
  const tc = await getTranslations("common");

  const roleIcons: Record<string, typeof Crown> = {
    owner: Crown,
    admin: ShieldCheck,
    member: User,
  };

  const roleColors: Record<string, string> = {
    owner: "text-warning-text bg-warning-soft",
    admin: "text-accent bg-accent-soft",
    member: "text-content-muted bg-surface-inset",
  };

  return (
    <NewTeamFormProvider>
      <div>
        {/* Row 1 — header: icon + H1, primary action right-aligned in
            the header cluster (list-pages.md rule 2). */}
        <div className="flex items-center gap-3">
          <Building2 size={24} className="text-accent" />
          <h1 className="text-page-title font-bold text-content">
            {tc("nav.teams")}
          </h1>
          <div className="ml-auto">
            <AddTeamTrigger />
          </div>
        </div>

        <NewTeamForm />

        {teams.length === 0 ? (
          <div className="mt-6 rounded-lg border border-edge bg-surface-raised p-8 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
              <Building2 size={20} className="text-accent" aria-hidden="true" />
            </div>
            <h3 className="text-body-lg font-medium text-content">
              {tc("teamsPage.emptyTitle")}
            </h3>
            <p className="mt-1 text-caption text-content-muted max-w-md mx-auto">
              {tc("teamsPage.emptyDescription")}
            </p>
          </div>
        ) : (
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
                      <p className="text-caption text-content-muted">{org.slug}</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium ${roleColor}`}
                    >
                      <RoleIcon size={12} />
                      {tc(`roles.${org.role}`)}
                    </span>
                    <LinkPendingSpinner />
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </NewTeamFormProvider>
  );
}
