"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Building2, Crown, ShieldCheck, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar, CustomerChip, resolveAvatarUrl } from "@theshyre/ui";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { Tooltip } from "@/components/Tooltip";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency } from "@/lib/invoice-utils";

/**
 * Team-hub preview rows — Customers / Projects / Members.
 *
 * These converge the /teams/[id] hub on the identity + status
 * treatments the rest of the app uses:
 *
 *   - Customers: CustomerChip + accent name (row links to the
 *     customer page) + Inactive lifecycle badge — same vocabulary
 *     as /customers.
 *   - Projects: sub-projects nest under their parent (↳ + indent +
 *     sr-only relationship text, mirroring projects-table), every
 *     row carries its StatusBadge and the Internal chip / customer
 *     attribution from /projects.
 *   - Members: round Avatar hashed on user_id (mandatory
 *     authorship-identity rule) + role badge in the same icon/color
 *     vocabulary as the members page; shell accounts get a neutral
 *     chip with a tooltip instead of raw "(shell)" text.
 *
 * Rows are whole-card links (bigger target than a bare name link) —
 * the name still reads as the accent link and underlines on hover
 * so the affordance matches the app's tables. Nothing focusable is
 * nested inside the anchors; tooltips only appear on non-link rows.
 */

/** Shared card chrome for one preview row. Links add hover + focus
 *  ring; static rows (members) use the same border/surface tokens so
 *  the three sections read as one family. */
const rowCardClass =
  "flex items-center gap-2 rounded-lg border border-edge bg-surface-raised px-3 py-2 text-body-lg";
const rowLinkClass = `group ${rowCardClass} transition-colors hover:border-accent/40 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2`;

export interface HubCustomerItem {
  id: string;
  name: string;
  defaultRate: number | null;
  logoUrl: string | null;
  /** Dormant-relationship marker (NULL = active). Active customers
   *  render no badge; inactive ones get the standard lifecycle
   *  StatusBadge so dormancy is visible at the hub too. */
  inactiveAt: string | null;
}

export function HubCustomerList({
  customers,
}: {
  customers: HubCustomerItem[];
}): React.JSX.Element {
  const tcu = useTranslations("customers");
  return (
    <ul className="mt-2 grid gap-2 sm:grid-cols-2">
      {customers.map((client) => (
        <li key={client.id}>
          <Link href={`/customers/${client.id}`} className={rowLinkClass}>
            <CustomerChip
              customerId={client.id}
              customerName={client.name}
              logoUrl={client.logoUrl}
              size={24}
            />
            <span className="font-medium text-accent truncate group-hover:underline">
              {client.name}
            </span>
            <LinkPendingSpinner />
            {client.inactiveAt !== null && (
              <StatusBadge status="inactive" label={tcu("status.inactive")} />
            )}
            {client.defaultRate !== null && (
              <span className="ml-auto text-caption text-content-muted font-mono tabular-nums shrink-0">
                {formatCurrency(Number(client.defaultRate))}/hr
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export interface HubProjectItem {
  id: string;
  name: string;
  status: string | null;
  isInternal: boolean;
  /** When set, this row is a sub-project. If the parent is visible
   *  in the same list it nests underneath it (↳ + indent); orphaned
   *  children (parent filtered out) render top-level — same rule as
   *  projects-table. */
  parentProjectId: string | null;
  customer: { id: string; name: string; logo_url: string | null } | null;
}

interface OrderedProjectRow {
  project: HubProjectItem;
  isChild: boolean;
  parentName: string | null;
}

/** Parent-then-child ordering, mirroring projects-table: top-level
 *  projects keep the caller's order, each parent's children follow
 *  it immediately, and a child whose parent isn't in the list
 *  renders as top-level so it never disappears. */
function orderProjectsForNesting(
  projects: HubProjectItem[],
): OrderedProjectRow[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const childrenByParent = new Map<string, HubProjectItem[]>();
  const tops: HubProjectItem[] = [];
  for (const p of projects) {
    if (p.parentProjectId !== null && byId.has(p.parentProjectId)) {
      const arr = childrenByParent.get(p.parentProjectId) ?? [];
      arr.push(p);
      childrenByParent.set(p.parentProjectId, arr);
    } else {
      tops.push(p);
    }
  }
  const out: OrderedProjectRow[] = [];
  for (const p of tops) {
    out.push({ project: p, isChild: false, parentName: null });
    for (const kid of childrenByParent.get(p.id) ?? []) {
      out.push({ project: kid, isChild: true, parentName: p.name });
    }
  }
  return out;
}

export function HubProjectList({
  projects,
  limit = 6,
}: {
  projects: HubProjectItem[];
  /** Rows rendered after parent-then-child ordering. Slicing happens
   *  AFTER ordering so a rendered child always sits under its
   *  rendered parent. */
  limit?: number;
}): React.JSX.Element {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const th = useTranslations("common.teamHub");
  const rows = useMemo(
    () => orderProjectsForNesting(projects).slice(0, limit),
    [projects, limit],
  );
  return (
    <ul className="mt-2 space-y-2">
      {rows.map(({ project, isChild, parentName }) => {
        const status = project.status ?? "active";
        return (
          <li key={project.id} className={isChild ? "ml-6" : undefined}>
            <Link href={`/projects/${project.id}`} className={rowLinkClass}>
              {isChild && (
                <span aria-hidden="true" className="text-content-muted">
                  ↳
                </span>
              )}
              <CustomerChip
                customerId={project.customer?.id ?? null}
                customerName={project.customer?.name ?? null}
                logoUrl={project.customer?.logo_url ?? null}
                internal={project.isInternal}
                size={24}
              />
              <span className="font-medium text-accent truncate group-hover:underline">
                {project.name}
              </span>
              {/* Relationship text sits AFTER the name so link lists /
                  rotor navigation stay name-first ("Phase 2, sub-project
                  of Website Redesign"). */}
              {isChild && (
                <span className="sr-only">
                  {th("projects.subprojectOf", {
                    parent: parentName ?? "",
                  })}
                </span>
              )}
              <LinkPendingSpinner />
              {project.isInternal && (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-caption font-medium text-content-secondary shrink-0">
                  <Building2 size={10} aria-hidden="true" />
                  {t("internal")}
                </span>
              )}
              <span className="ml-auto flex items-center gap-2 min-w-0 shrink-0">
                {/* Trailing attribution only for non-internal rows — the
                    internal chip + pill already carry that fact twice.
                    A customer-less EXTERNAL project must never read
                    "Internal" (channels have to agree), so it falls back
                    to the same "No customer" label as /projects.
                    Truncation cap in rem so it scales with the user's
                    text-size preference. */}
                {!project.isInternal && (
                  <span className="text-caption text-content-muted truncate max-w-40">
                    {project.customer?.name ?? t("groupNoCustomer")}
                  </span>
                )}
                <StatusBadge status={status} label={tc(`status.${status}`)} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export interface HubMemberItem {
  id: string;
  userId: string;
  role: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** Shell accounts are imported anchors for historical time entries
   *  — real auth.users rows that can't sign in (see
   *  `src/lib/import-shell-author.ts`). Rendered with a neutral
   *  "Imported" chip + explanatory tooltip. */
  isShell: boolean;
}

/** Same role icon/color vocabulary as the members management page
 *  (team-section.tsx) so a role reads identically on both surfaces. */
const ROLE_ICONS: Record<string, LucideIcon> = {
  owner: Crown,
  admin: ShieldCheck,
  member: User,
};
const ROLE_COLORS: Record<string, string> = {
  owner: "text-warning-text bg-warning-soft",
  admin: "text-accent bg-accent-soft",
  member: "text-content-muted bg-surface-inset",
};
const KNOWN_ROLES = new Set(["owner", "admin", "member"]);

export function HubMemberList({
  members,
}: {
  members: HubMemberItem[];
}): React.JSX.Element {
  const tc = useTranslations("common");
  const th = useTranslations("common.teamHub");
  return (
    <ul className="mt-2 grid gap-2 sm:grid-cols-2">
      {members.map((m) => {
        const name = m.displayName ?? th("members.unnamed");
        const RoleIcon = ROLE_ICONS[m.role] ?? User;
        const roleColor = ROLE_COLORS[m.role] ?? "text-content-muted bg-surface-inset";
        const roleLabel = KNOWN_ROLES.has(m.role)
          ? tc(`roles.${m.role}`)
          : m.role;
        return (
          <li key={m.id} className={rowCardClass}>
            {/* aria-hidden wrapper: per the entity-identity rule the
                accessible name comes from the visible text next to the
                mark — Avatar's internal aria-label would double-announce
                the name otherwise. (Upstream `decorative` prop on Avatar
                in theshyre-core is the tracked long-term fix.) */}
            <span aria-hidden="true">
              <Avatar
                avatarUrl={resolveAvatarUrl(m.avatarUrl, m.userId)}
                displayName={name}
                size={24}
              />
            </span>
            <span className="font-medium text-content truncate">{name}</span>
            {m.isShell && (
              <Tooltip label={th("members.shellTooltip")}>
                {/* tabIndex makes the chip a Tab stop so keyboard-only
                    users can open the explanatory tooltip — member rows
                    otherwise contain no focusable element. The Tooltip
                    primitive wires aria-describedby on focus-open. */}
                <span
                  tabIndex={0}
                  className="inline-flex items-center rounded-full border border-edge-muted bg-surface-inset px-2 py-0.5 text-label font-medium text-content-muted shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  {th("members.shellChip")}
                </span>
              </Tooltip>
            )}
            <span
              className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label font-medium shrink-0 ${roleColor}`}
            >
              <RoleIcon size={10} aria-hidden="true" />
              {roleLabel}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
