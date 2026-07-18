import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams, isTeamAdmin } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  FileSignature,
  FileText,
  FolderKanban,
  Plus,
  Users,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { CustomerChip } from "@/components/CustomerChip";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { formatCurrency } from "@/lib/invoice-utils";
import { effectiveInvoiceStatus } from "@/lib/invoice-status";
import { roundMoney } from "@/lib/proposals/line-items";
import {
  displayProposalTotal,
  isProposalExpired,
} from "@/lib/proposals/list-view";
import { ProposalStatusBadge } from "../../proposals/proposal-status-badge";
import { InvoiceStatusBadge } from "../../invoices/invoice-status-badge";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (!customer) {
    const t = await getTranslations("customers");
    return { title: t("title") };
  }
  return { title: customer.name as string };
}
import { CustomerEditForm } from "./customer-edit-form";
import { SharingSection } from "./sharing-section";
import { PermissionsSection } from "./permissions-section";
import {
  ContactsSection,
  type ContactRow,
} from "./contacts-section";

interface ShareRow {
  id: string;
  team_id: string;
  can_see_others_entries: boolean;
  teams: { name: string } | { name: string }[] | null;
}

interface PermRow {
  id: string;
  principal_type: "user" | "group";
  principal_id: string;
  permission_level: "viewer" | "contributor" | "admin";
}

interface TeamMemberRow {
  team_id: string;
  user_id: string;
  user_profiles:
    | { display_name: string | null; is_shell: boolean | null }[]
    | { display_name: string | null; is_shell: boolean | null }
    | null;
}

interface SecurityGroupRow {
  id: string;
  team_id: string;
  name: string;
}

function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Compact-list cap for the proposals / invoices sections — enough
 *  to scan recent history; the "View all" link carries the rest. */
const COMPACT_LIST_LIMIT = 6;

function displayName(
  profile:
    | { display_name: string | null }[]
    | { display_name: string | null }
    | null,
  fallback: string,
): string {
  const p = Array.isArray(profile) ? profile[0] : profile;
  return p?.display_name ?? fallback;
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const t = await getTranslations("customers");
  const tProjectStatus = await getTranslations("projects.status.label");

  const { data: client } = await supabase
    .from("customers_v")
    .select("*")
    .eq("id", id)
    .single();

  if (!client) notFound();

  const { data: projects } = await supabase
    .from("projects_v")
    .select("*")
    .eq("customer_id", id)
    .order("created_at", { ascending: false });

  // Compact recent-history lists: this customer's proposals and
  // invoices (capped, with a count for the "View all" link). RLS
  // scopes both — members simply see empty sections for proposals.
  const [
    { data: proposalRows, count: proposalCount },
    { data: invoiceRows, count: invoiceCount },
  ] = await Promise.all([
    supabase
      .from("proposals")
      .select(
        "id, proposal_number, title, status, issued_date, valid_until, currency, accepted_total, proposal_line_items(fixed_price, parent_line_item_id)",
        { count: "exact" },
      )
      .eq("customer_id", id)
      .order("issued_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(0, COMPACT_LIST_LIMIT - 1),
    supabase
      .from("invoices")
      .select("id, invoice_number, status, due_date, issued_date, total, currency", {
        count: "exact",
      })
      .eq("customer_id", id)
      .order("issued_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(0, COMPACT_LIST_LIMIT - 1),
  ]);

  const today = todayLocalDate();
  const customerProposals = (proposalRows ?? []).map((p) => {
    const items = (p.proposal_line_items ?? []) as Array<{
      fixed_price: number | string;
      parent_line_item_id: string | null;
    }>;
    // Phases break down their parent — only top-level rows count.
    const total = roundMoney(
      items
        .filter((li) => li.parent_line_item_id === null)
        .reduce((sum, li) => sum + Number(li.fixed_price), 0),
    );
    const status = (p.status as string) ?? "draft";
    return {
      id: p.id as string,
      number: p.proposal_number as string,
      title: p.title as string,
      status,
      expired: isProposalExpired(
        status,
        (p.valid_until as string | null) ?? null,
        today,
      ),
      total: displayProposalTotal(
        status,
        total,
        p.accepted_total != null ? Number(p.accepted_total) : null,
      ),
      currency: (p.currency as string) ?? "USD",
    };
  });
  const customerInvoices = (invoiceRows ?? []).map((inv) => ({
    id: inv.id as string,
    number: inv.invoice_number as string,
    status: effectiveInvoiceStatus(
      (inv.status as string | null) ?? "draft",
      (inv.due_date as string | null) ?? null,
      today,
    ),
    total: inv.total != null ? Number(inv.total) : null,
    currency: (inv.currency as string | null) ?? undefined,
  }));

  // Sharing data
  const { data: sharesData } = await supabase
    .from("customer_shares")
    .select("id, team_id, can_see_others_entries, teams(name)")
    .eq("customer_id", id);
  const shares = (sharesData ?? []) as unknown as ShareRow[];

  // Permission level for current user
  const { data: permLevel } = await supabase.rpc("user_customer_permission", {
    p_customer_id: id,
  });
  const userCanAdmin = permLevel === "admin";

  // Customer contacts. Read is open to any team member; the
  // canManage gate (owner/admin of the customer's team) decides
  // whether the affordances render.
  const { data: contactsData } = await supabase
    .from("customer_contacts")
    .select("id, name, email, role_label, is_invoice_recipient")
    .eq("customer_id", id)
    .order("is_invoice_recipient", { ascending: false })
    .order("created_at", { ascending: true });
  const contacts: ContactRow[] = (contactsData ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    email: c.email as string,
    role_label: (c.role_label as string | null) ?? null,
    is_invoice_recipient: Boolean(c.is_invoice_recipient),
  }));

  // User's teams (for available teams & primary change)
  const userOrgs = await getUserTeams();
  const sharedTeamIds = new Set(shares.map((s) => s.team_id));
  const availableTeams = userOrgs
    .filter((o) => o.id !== client.team_id && !sharedTeamIds.has(o.id))
    .map((o) => ({ id: o.id, name: o.name }));

  // Primary org name
  const { data: primaryTeam } = await supabase
    .from("teams")
    .select("id, name")
    .eq("id", client.team_id)
    .single();
  const primaryTeamName = primaryTeam?.name ?? "—";

  // Can change primary: user is owner of current primary
  const currentPrimaryMembership = userOrgs.find(
    (o) => o.id === client.team_id,
  );
  // Proposal authoring is owner/admin of the customer's own team —
  // the same tier /proposals/new enforces server-side.
  const canCreateProposal =
    currentPrimaryMembership !== undefined &&
    isTeamAdmin(currentPrimaryMembership.role);
  const canChangePrimary = currentPrimaryMembership?.role === "owner";
  const changePrimaryTeams = userOrgs
    .filter((o) => o.id !== client.team_id)
    .map((o) => ({ id: o.id, name: o.name }));

  // Permissions data
  const { data: permsData } = await supabase
    .from("customer_permissions")
    .select("id, principal_type, principal_id, permission_level")
    .eq("customer_id", id);
  const perms = (permsData ?? []) as unknown as PermRow[];

  // Participating org ids (primary + shared) for member/group lookup
  const allTeamIds = [
    client.team_id,
    ...shares.map((s) => s.team_id),
  ];

  // Members of all those teams. Two-step fetch: team_members has no
  // FK to user_profiles (both reference auth.users separately), so
  // PostgREST embedding fails with PGRST200. Pull profiles in a
  // second query and stitch on the embedded shape the principal
  // picker / display-name resolver already expects.
  const { data: rawTeamMembers } = allTeamIds.length
    ? await supabase
        .from("team_members")
        .select("team_id, user_id")
        .in("team_id", allTeamIds)
    : { data: [] as Array<{ team_id: string; user_id: string }> };
  const distinctMemberUserIds = Array.from(
    new Set((rawTeamMembers ?? []).map((m) => m.user_id as string)),
  );
  const { data: memberProfileRows } = distinctMemberUserIds.length
    ? await supabase
        .from("user_profiles")
        .select("user_id, display_name, is_shell")
        .in("user_id", distinctMemberUserIds)
    : {
        data: [] as Array<{
          user_id: string;
          display_name: string | null;
          is_shell: boolean | null;
        }>,
      };
  const profileByMemberUserId = new Map<
    string,
    { display_name: string | null; is_shell: boolean | null }
  >();
  for (const p of memberProfileRows ?? []) {
    profileByMemberUserId.set(p.user_id as string, {
      display_name: (p.display_name as string | null) ?? null,
      is_shell: (p.is_shell as boolean | null) ?? null,
    });
  }
  const teamMembers: TeamMemberRow[] = (rawTeamMembers ?? []).map((m) => ({
    team_id: m.team_id as string,
    user_id: m.user_id as string,
    user_profiles: profileByMemberUserId.get(m.user_id as string) ?? null,
  }));

  // Security groups of all those teams
  const { data: groupsData } = allTeamIds.length
    ? await supabase
        .from("security_groups")
        .select("id, team_id, name")
        .in("team_id", allTeamIds)
    : { data: [] };
  const groups = (groupsData ?? []) as unknown as SecurityGroupRow[];

  // Org name lookup for display
  const teamNameById = new Map<string, string>();
  teamNameById.set(client.team_id, primaryTeamName);
  for (const s of shares) {
    const name = Array.isArray(s.teams)
      ? s.teams[0]?.name
      : s.teams?.name;
    if (name) teamNameById.set(s.team_id, name);
  }

  // Build available principals list (dedupe users by id)
  const seenUserIds = new Set<string>();
  const availablePrincipals: Array<{
    type: "user" | "group";
    id: string;
    name: string;
    teamName: string;
  }> = [];
  for (const m of teamMembers) {
    if (seenUserIds.has(m.user_id)) continue;
    // Shell accounts can't sign in, so granting them customer
    // permissions is meaningless clutter. Skip them entirely from
    // the principal picker. They still appear in the team member
    // list (with the "Imported · no login" badge) for audit /
    // authorship visibility.
    const profileRaw = m.user_profiles;
    const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;
    if (profile && (profile as { is_shell?: boolean | null }).is_shell) {
      continue;
    }
    seenUserIds.add(m.user_id);
    availablePrincipals.push({
      type: "user",
      id: m.user_id,
      name: displayName(m.user_profiles, m.user_id.slice(0, 8) + "…"),
      teamName: teamNameById.get(m.team_id) ?? "—",
    });
  }
  for (const g of groups) {
    availablePrincipals.push({
      type: "group",
      id: g.id,
      name: g.name,
      teamName: teamNameById.get(g.team_id) ?? "—",
    });
  }

  // Resolve principal_name for existing permissions
  const userNameById = new Map<string, string>();
  for (const m of teamMembers) {
    if (!userNameById.has(m.user_id)) {
      userNameById.set(
        m.user_id,
        displayName(m.user_profiles, m.user_id.slice(0, 8) + "…"),
      );
    }
  }
  const groupNameById = new Map<string, string>();
  for (const g of groups) groupNameById.set(g.id, g.name);

  const permissions = perms.map((p) => ({
    id: p.id,
    principal_type: p.principal_type,
    principal_id: p.principal_id,
    permission_level: p.permission_level,
    principal_name:
      p.principal_type === "user"
        ? userNameById.get(p.principal_id) ??
          p.principal_id.slice(0, 8) + "…"
        : groupNameById.get(p.principal_id) ?? "Group",
  }));

  // Defensive fallback: customers.name is NOT NULL in schema, so
  // this only fires if the column constraint changes or a future
  // migration adds nullable rows. Mirrors the business/team
  // headers — every detail page is required to render
  // identifying text in the h1, never a generic noun.
  const customerName = (client.name as string | null) ?? t("untitled");

  return (
    <div>
      <div className="flex items-center gap-3">
        {/* The customer's own identity-mark, not a generic icon — this is
            the one page that IS the customer (entity-identity rule). */}
        <CustomerChip
          customerId={client.id as string}
          customerName={customerName}
          logoUrl={(client.logo_url as string | null) ?? null}
          size={24}
        />
        <h1 className="text-page-title font-bold text-content break-words">
          {customerName}
        </h1>
      </div>
      <p className="mt-1 text-caption text-content-muted">
        {t("editSubtitle")}
      </p>

      <div className="mt-6">
        <CustomerEditForm client={client} />
      </div>

      <ContactsSection
        customerId={id}
        contacts={contacts}
        canManage={userCanAdmin}
      />

      <div className="mt-8">
        <div className="flex items-center gap-3">
          <FolderKanban size={20} className="text-accent" />
          <h2 className="text-title font-semibold text-content">
            {t("projects.title")}
          </h2>
        </div>
        {projects && projects.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {projects.map((p) => (
              <li key={p.id}>
                {/* Whole row is a real link — it was hover-styled but inert,
                    a false affordance. Status renders through the shared
                    StatusBadge (translated, 2-channel) instead of a raw
                    enum in a gray pill. */}
                <Link
                  href={`/projects/${p.id}`}
                  className="flex items-center justify-between rounded-lg border border-edge bg-surface-raised px-4 py-3 hover:bg-hover transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <LinkPendingSpinner />
                    <span className="font-medium text-content">{p.name}</span>
                    {p.status !== "active" && (
                      <StatusBadge
                        status={p.status as string}
                        label={tProjectStatus(p.status as string)}
                      />
                    )}
                  </span>
                  <span className="text-body-lg text-content-secondary font-mono">
                    {p.hourly_rate
                      ? `${formatCurrency(Number(p.hourly_rate))}/hr`
                      : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-body-lg text-content-muted">
            {t("projects.noProjects")}
          </p>
        )}
      </div>

      {/* Proposals — compact recent list + the entry point for
          quoting new work for THIS customer. */}
      <div className="mt-8">
        <div className="flex items-center gap-3 flex-wrap">
          <FileSignature size={20} className="text-accent" />
          <h2 className="text-title font-semibold text-content">
            {t("proposalsSection.title")}
          </h2>
          {canCreateProposal && (
            <Link
              href={`/proposals/new?customerId=${id}`}
              className={`${buttonSecondaryClass} ml-auto`}
            >
              <Plus size={14} />
              {t("proposalsSection.newProposal")}
            </Link>
          )}
        </div>
        {customerProposals.length > 0 ? (
          <>
            <ul className="mt-3 space-y-2">
              {customerProposals.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/proposals/${p.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface-raised px-4 py-3 hover:bg-hover transition-colors"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <LinkPendingSpinner />
                      <span className="font-mono text-caption text-content-secondary">
                        {p.number}
                      </span>
                      <span className="truncate font-medium text-content">
                        {p.title}
                      </span>
                      <ProposalStatusBadge status={p.status} expired={p.expired} />
                    </span>
                    <span className="shrink-0 text-body-lg text-content-secondary font-mono">
                      {formatCurrency(p.total, p.currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {(proposalCount ?? 0) > customerProposals.length && (
              <Link
                href="/proposals"
                className="mt-2 inline-flex items-center gap-1 text-body text-accent hover:underline"
              >
                {t("proposalsSection.viewAll", { count: proposalCount ?? 0 })}
                <ArrowRight size={14} />
              </Link>
            )}
          </>
        ) : (
          <p className="mt-3 text-body-lg text-content-muted">
            {t("proposalsSection.none")}
          </p>
        )}
      </div>

      {/* Invoices — compact recent list with read-time overdue. */}
      <div className="mt-8">
        <div className="flex items-center gap-3">
          <FileText size={20} className="text-accent" />
          <h2 className="text-title font-semibold text-content">
            {t("invoicesSection.title")}
          </h2>
        </div>
        {customerInvoices.length > 0 ? (
          <>
            <ul className="mt-3 space-y-2">
              {customerInvoices.map((inv) => (
                <li key={inv.id}>
                  <Link
                    href={`/invoices/${inv.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface-raised px-4 py-3 hover:bg-hover transition-colors"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <LinkPendingSpinner />
                      <span className="font-mono font-medium text-content">
                        {inv.number}
                      </span>
                      <InvoiceStatusBadge status={inv.status} />
                    </span>
                    <span className="shrink-0 text-body-lg text-content-secondary font-mono">
                      {inv.total !== null
                        ? formatCurrency(inv.total, inv.currency)
                        : "—"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {(invoiceCount ?? 0) > customerInvoices.length && (
              <Link
                href={`/invoices?customerId=${id}`}
                className="mt-2 inline-flex items-center gap-1 text-body text-accent hover:underline"
              >
                {t("invoicesSection.viewAll", { count: invoiceCount ?? 0 })}
                <ArrowRight size={14} />
              </Link>
            )}
          </>
        ) : (
          <p className="mt-3 text-body-lg text-content-muted">
            {t("invoicesSection.none")}
          </p>
        )}
      </div>

      <SharingSection
        customerId={id}
        primaryTeamId={client.team_id}
        primaryTeamName={primaryTeamName}
        shares={shares}
        availableTeams={availableTeams}
        userCanAdmin={userCanAdmin}
        changePrimaryTeams={changePrimaryTeams}
        canChangePrimary={canChangePrimary}
      />

      <PermissionsSection
        customerId={id}
        permissions={permissions}
        availablePrincipals={availablePrincipals}
        userCanAdmin={userCanAdmin}
      />
    </div>
  );
}
