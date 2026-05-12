import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { validateTeamAccess } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: team } = await supabase
    .from("teams")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  return { title: (team?.name as string | undefined) ?? "Team" };
}
import {
  Building2,
  Users,
  FolderKanban,
  ArrowRight,
  Mail,
  Network,
  type LucideIcon,
} from "lucide-react";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { CustomerChip } from "@/components/CustomerChip";

/**
 * Team overview — the at-a-glance landing for a team.
 *
 * Two halves:
 *
 *   1. Cross-cutting previews (Customers, Projects, Members) — these
 *      summarize work that lives in other top-level pages and act as
 *      shortcuts. Top 6 of each + "View all →".
 *
 *   2. Configure card grid — entry points for team-scoped settings
 *      that used to all live inline on this page (back when it had
 *      seven stacked sections and was unreadable). Each card is its
 *      own sub-route now: /general, /members, /relationships, /email.
 *      Mirrors the /settings hub-of-cards pattern so users get a
 *      consistent navigation model across configuration surfaces.
 *
 * Ownership / role visibility:
 *   - Owner/admin can act on every card; members see them but the
 *     destination pages render in read-only mode where appropriate.
 *   - The role chip next to the team name is the at-a-glance signal
 *     for what level of access the current user has.
 */
export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const { role } = await validateTeamAccess(id);

  const { data: org } = await supabase
    .from("teams")
    .select("*")
    .eq("id", id)
    .single();

  if (!org) notFound();

  // Members preview — top five active members, sorted owner → admin
  // → member. Owners/admins can jump to /members for the full
  // management surface.
  const { data: rawMembers } = await supabase
    .from("team_members")
    .select("id, user_id, role, joined_at")
    .eq("team_id", id);
  const memberUserIds = (rawMembers ?? []).map((m) => m.user_id as string);
  const { data: profileRows } =
    memberUserIds.length > 0
      ? await supabase
          .from("user_profiles")
          .select("user_id, display_name, is_shell")
          .in("user_id", memberUserIds)
      : { data: [] };
  const profileByUserId = new Map<
    string,
    { display_name: string | null; is_shell: boolean }
  >(
    (profileRows ?? []).map((p) => [
      p.user_id as string,
      {
        display_name: (p.display_name as string | null) ?? null,
        is_shell:
          ((p as { is_shell?: boolean | null }).is_shell ?? false) === true,
      },
    ]),
  );
  const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, member: 2 };
  const memberPreview = (rawMembers ?? [])
    .map((m) => {
      const prof = profileByUserId.get(m.user_id as string);
      return {
        id: m.id as string,
        userId: m.user_id as string,
        role: m.role as string,
        displayName: prof?.display_name ?? null,
        isShell: prof?.is_shell ?? false,
      };
    })
    .sort((a, b) => {
      if (a.isShell !== b.isShell) return a.isShell ? 1 : -1;
      return (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99);
    })
    .slice(0, 6);
  const memberCount = (rawMembers ?? []).length;

  // Org's customers — top 6 active.
  const { data: customers } = await supabase
    .from("customers_v")
    .select("id, name, email, default_rate")
    .eq("team_id", id)
    .eq("archived", false)
    .order("name");

  // Org's projects — top 6 non-archived.
  const { data: projects } = await supabase
    .from("projects_v")
    .select(
      "id, name, status, hourly_rate, customer_id, is_internal, customers(id, name)",
    )
    .eq("team_id", id)
    .neq("status", "archived")
    .order("created_at", { ascending: false });

  const tc = await getTranslations("common");
  const tp = await getTranslations("projects");
  const th = await getTranslations("common.teamHub");

  interface ConfigCard {
    id: string;
    title: string;
    description: string;
    href: string;
    icon: LucideIcon;
  }
  const configCards: ConfigCard[] = [
    {
      id: "general",
      title: th("general.title"),
      description: th("general.description"),
      href: `/teams/${id}/general`,
      icon: Building2,
    },
    {
      id: "members",
      title: th("members.title"),
      description: th("members.description"),
      href: `/teams/${id}/members`,
      icon: Users,
    },
    {
      id: "relationships",
      title: th("relationships.title"),
      description: th("relationships.description"),
      href: `/teams/${id}/relationships`,
      icon: Network,
    },
    {
      id: "email",
      title: th("emailSetup.title"),
      description: th("emailSetup.description"),
      href: `/teams/${id}/email`,
      icon: Mail,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Building2 size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">{org.name}</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2.5 py-0.5 text-caption font-medium text-content-muted">
          {role}
        </span>
      </div>

      {/* Customers */}
      <section>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-accent" />
            <h2 className="text-body-lg font-semibold uppercase tracking-wider text-content-muted">
              {tc("nav.customers")}
            </h2>
          </div>
          <Link
            href={`/customers?team=${id}`}
            className="flex items-center gap-1 text-caption text-accent hover:underline"
          >
            <LinkPendingSpinner />
            {tc("viewAll")} <ArrowRight size={12} />
          </Link>
        </div>
        {customers && customers.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {customers.slice(0, 6).map((client) => (
              <Link
                key={client.id}
                href={`/customers/${client.id}`}
                className="flex items-center gap-2 rounded-lg border border-edge bg-surface-raised px-3 py-2 text-body-lg hover:bg-hover transition-colors"
              >
                <CustomerChip
                  customerId={client.id}
                  customerName={client.name}
                />
                <span className="font-medium text-content truncate">
                  {client.name}
                </span>
                {client.default_rate && (
                  <span className="ml-auto text-caption text-content-muted font-mono">
                    ${Number(client.default_rate).toFixed(0)}/hr
                  </span>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-body-lg text-content-muted">
            {th("empty.customers")}
          </p>
        )}
      </section>

      {/* Projects */}
      <section>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderKanban size={18} className="text-accent" />
            <h2 className="text-body-lg font-semibold uppercase tracking-wider text-content-muted">
              {tc("nav.projects")}
            </h2>
          </div>
          <Link
            href={`/projects?team=${id}`}
            className="flex items-center gap-1 text-caption text-accent hover:underline"
          >
            <LinkPendingSpinner />
            {tc("viewAll")} <ArrowRight size={12} />
          </Link>
        </div>
        {projects && projects.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {projects.slice(0, 6).map((project) => {
              const customerName =
                project.customers &&
                typeof project.customers === "object" &&
                "name" in project.customers
                  ? (project.customers as { name: string }).name
                  : null;
              const customerId =
                project.customers &&
                typeof project.customers === "object" &&
                "id" in project.customers
                  ? (project.customers as { id: string }).id
                  : null;
              const projectIsInternal = project.is_internal === true;
              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center gap-2 rounded-lg border border-edge bg-surface-raised px-3 py-2 text-body-lg hover:bg-hover transition-colors"
                >
                  {customerName ? (
                    <CustomerChip
                      customerId={customerId}
                      customerName={customerName}
                    />
                  ) : projectIsInternal ? (
                    <CustomerChip
                      customerId={null}
                      customerName={null}
                      internal
                    />
                  ) : null}
                  <span className="font-medium text-content truncate">
                    {project.name}
                  </span>
                  <span className="ml-auto text-caption text-content-muted truncate">
                    {customerName ?? tp("internal")}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-body-lg text-content-muted">
            {th("empty.projects")}
          </p>
        )}
      </section>

      {/* Members preview */}
      <section>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-accent" />
            <h2 className="text-body-lg font-semibold uppercase tracking-wider text-content-muted">
              {th("members.title")}
              {memberCount > 0 && (
                <span className="ml-2 normal-case font-normal text-content-muted">
                  ({memberCount})
                </span>
              )}
            </h2>
          </div>
          <Link
            href={`/teams/${id}/members`}
            className="flex items-center gap-1 text-caption text-accent hover:underline"
          >
            <LinkPendingSpinner />
            {tc("viewAll")} <ArrowRight size={12} />
          </Link>
        </div>
        {memberPreview.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {memberPreview.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg border border-edge bg-surface-raised px-3 py-2 text-body-lg"
              >
                <span className="font-medium text-content truncate">
                  {m.displayName ?? th("members.unnamed")}
                  {m.isShell && (
                    <span className="ml-1.5 text-caption text-content-muted italic">
                      ({th("members.shell")})
                    </span>
                  )}
                </span>
                <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2 py-0.5 text-caption text-content-muted">
                  {m.role}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-body-lg text-content-muted">
            {th("empty.members")}
          </p>
        )}
      </section>

      {/* Configure */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-body-lg font-semibold uppercase tracking-wider text-content-muted">
            {th("configureHeading")}
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
          {configCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.id}
                href={card.href}
                className="group flex items-start gap-3 rounded-lg border border-edge bg-surface-raised p-4 transition-colors hover:border-accent/40 hover:bg-hover"
              >
                <Icon size={20} className="mt-0.5 text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-body-lg font-semibold text-content">
                      {card.title}
                    </span>
                    <LinkPendingSpinner />
                  </div>
                  <p className="text-caption text-content-muted mt-1">
                    {card.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
