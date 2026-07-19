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
  UsersRound,
  FolderKanban,
  ArrowRight,
  Mail,
  Network,
  type LucideIcon,
} from "lucide-react";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import {
  HubCustomerList,
  HubMemberList,
  HubProjectList,
  type HubCustomerItem,
  type HubMemberItem,
  type HubProjectItem,
} from "./hub-sections";

/** Preview size for each cross-cutting section. */
const PREVIEW_LIMIT = 6;

/** "View all →" header-link treatment (dashboard convention) + the
 *  standard focus ring so keyboard visibility matches the row links. */
const viewAllLinkClass =
  "flex items-center gap-1 rounded text-body-lg text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2";

/**
 * Team overview — the at-a-glance landing for a team.
 *
 * Two halves:
 *
 *   1. Cross-cutting previews (Customers, Projects, Members) — these
 *      summarize work that lives in other top-level pages and act as
 *      shortcuts. Top 6 of each + "View all →". Row rendering lives
 *      in `hub-sections.tsx` and converges on the app's standard
 *      identity/status treatments (CustomerChip, StatusBadge,
 *      sub-project nesting, Avatar + role badge).
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

  // Members preview — active members first, sorted owner → admin
  // → member, shell accounts last. Owners/admins can jump to
  // /members for the full management surface.
  const { data: rawMembers } = await supabase
    .from("team_members")
    .select("id, user_id, role, joined_at")
    .eq("team_id", id);
  const memberUserIds = (rawMembers ?? []).map((m) => m.user_id as string);
  const { data: profileRows } =
    memberUserIds.length > 0
      ? await supabase
          .from("user_profiles")
          .select("user_id, display_name, avatar_url, is_shell")
          .in("user_id", memberUserIds)
      : { data: [] };
  const profileByUserId = new Map<
    string,
    { display_name: string | null; avatar_url: string | null; is_shell: boolean }
  >(
    (profileRows ?? []).map((p) => [
      p.user_id as string,
      {
        display_name: (p.display_name as string | null) ?? null,
        avatar_url:
          ((p as { avatar_url?: string | null }).avatar_url ?? null),
        is_shell:
          ((p as { is_shell?: boolean | null }).is_shell ?? false) === true,
      },
    ]),
  );
  const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, member: 2 };
  const memberPreview: HubMemberItem[] = (rawMembers ?? [])
    .map((m) => {
      const prof = profileByUserId.get(m.user_id as string);
      return {
        id: m.id as string,
        userId: m.user_id as string,
        role: m.role as string,
        displayName: prof?.display_name ?? null,
        avatarUrl: prof?.avatar_url ?? null,
        isShell: prof?.is_shell ?? false,
      };
    })
    .sort((a, b) => {
      if (a.isShell !== b.isShell) return a.isShell ? 1 : -1;
      return (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99);
    })
    .slice(0, PREVIEW_LIMIT);
  const memberCount = (rawMembers ?? []).length;

  // Org's customers — top 6 by name, non-archived. Inactive
  // (dormant) customers stay visible with their lifecycle badge.
  const { data: customers } = await supabase
    .from("customers_v")
    .select("id, name, email, default_rate, logo_url, inactive_at")
    .eq("team_id", id)
    .eq("archived", false)
    .order("name");
  const customerCount = (customers ?? []).length;
  const customerPreview: HubCustomerItem[] = (customers ?? [])
    .slice(0, PREVIEW_LIMIT)
    .map((c) => ({
      id: c.id as string,
      name: c.name as string,
      defaultRate:
        c.default_rate === null || c.default_rate === undefined
          ? null
          : Number(c.default_rate),
      logoUrl: ((c as { logo_url?: string | null }).logo_url ?? null),
      inactiveAt: ((c as { inactive_at?: string | null }).inactive_at ?? null),
    }));

  // Org's projects — newest first, non-archived. The FULL set goes
  // to the client list so sub-projects can nest under their parents
  // before the preview slice (slicing first could strand a child
  // whose parent sorts later).
  const { data: projects } = await supabase
    .from("projects_v")
    .select(
      "id, name, status, parent_project_id, is_internal, customers(id, name, logo_url)",
    )
    .eq("team_id", id)
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  const projectItems: HubProjectItem[] = (projects ?? []).map((p) => {
    const rawCustomer = Array.isArray(p.customers)
      ? (p.customers[0] ?? null)
      : (p.customers ?? null);
    const customer =
      rawCustomer && typeof rawCustomer === "object" && "id" in rawCustomer
        ? {
            id: (rawCustomer as { id: string }).id,
            name: (rawCustomer as { name: string }).name,
            logo_url:
              ((rawCustomer as { logo_url?: string | null }).logo_url ?? null),
          }
        : null;
    return {
      id: p.id as string,
      name: p.name as string,
      status: (p.status as string | null) ?? null,
      isInternal: p.is_internal === true,
      parentProjectId: (p.parent_project_id as string | null) ?? null,
      customer,
    };
  });

  const tc = await getTranslations("common");
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
      // UsersRound (not Users) — Users is the customers-module icon
      // app-wide; the two member surfaces on this page use a distinct
      // people glyph so the icon channel stays a signal.
      icon: UsersRound,
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
        <Building2 size={24} className="text-accent" aria-hidden="true" />
        <h1 className="text-page-title font-bold text-content">{org.name}</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2.5 py-0.5 text-caption font-medium text-content-muted">
          {tc(`roles.${role}`)}
        </span>
      </div>

      {/* Customers */}
      <section>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-accent" aria-hidden="true" />
            <h2 className="text-title font-semibold text-content">
              {tc("nav.customers")}
            </h2>
            {customerCount > 0 && (
              <span className="text-body text-content-muted">
                ({customerCount})
              </span>
            )}
          </div>
          <Link
            href={`/customers?org=${id}`}
            aria-label={tc("viewAllSection", { section: tc("nav.customers") })}
            className={viewAllLinkClass}
          >
            <LinkPendingSpinner />
            {tc("viewAll")}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
        {customerPreview.length > 0 ? (
          <HubCustomerList customers={customerPreview} />
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
            <FolderKanban size={18} className="text-accent" aria-hidden="true" />
            <h2 className="text-title font-semibold text-content">
              {tc("nav.projects")}
            </h2>
            {projectItems.length > 0 && (
              <span className="text-body text-content-muted">
                ({projectItems.length})
              </span>
            )}
          </div>
          <Link
            href={`/projects?org=${id}`}
            aria-label={tc("viewAllSection", { section: tc("nav.projects") })}
            className={viewAllLinkClass}
          >
            <LinkPendingSpinner />
            {tc("viewAll")}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
        {projectItems.length > 0 ? (
          <HubProjectList projects={projectItems} limit={PREVIEW_LIMIT} />
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
            <UsersRound size={18} className="text-accent" aria-hidden="true" />
            <h2 className="text-title font-semibold text-content">
              {th("members.title")}
            </h2>
            {memberCount > 0 && (
              <span className="text-body text-content-muted">
                ({memberCount})
              </span>
            )}
          </div>
          <Link
            href={`/teams/${id}/members`}
            aria-label={tc("viewAllSection", { section: th("members.title") })}
            className={viewAllLinkClass}
          >
            <LinkPendingSpinner />
            {tc("viewAll")}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
        {memberPreview.length > 0 ? (
          <HubMemberList members={memberPreview} />
        ) : (
          <p className="mt-2 text-body-lg text-content-muted">
            {th("empty.members")}
          </p>
        )}
      </section>

      {/* Configure */}
      <section>
        <h2 className="text-title font-semibold text-content mb-3">
          {th("configureHeading")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
          {configCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.id}
                href={card.href}
                className="group flex items-start gap-3 rounded-lg border border-edge bg-surface-raised p-4 transition-colors hover:border-accent/40 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
              >
                <Icon size={20} className="mt-0.5 text-accent shrink-0" aria-hidden="true" />
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
