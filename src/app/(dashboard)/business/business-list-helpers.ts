/**
 * Pure helpers for the business list page (`/business`). Extracted
 * from `page.tsx` for testability — the page is a server component
 * that hits Supabase, but the math + formatting + role aggregation
 * are deterministic and worth pinning behaviorally.
 */

import { isTeamAdmin } from "@/lib/team-roles";

export type Role = "owner" | "admin" | "member";

/**
 * Team ids a viewer may see FINANCIALS for within a business: only the
 * teams where they hold owner/admin. Financial confidentiality is a
 * PER-TEAM decision, never the business-aggregate role — a viewer who
 * is admin on one team and a plain member on another under the same
 * business must not see the member-team's revenue/expenses. Summing
 * financials over the aggregate-max-role team set was the leak fixed
 * in SAL-057; this helper is the gate. (Membership scoping still
 * applies upstream — the caller only ever passes teams the viewer
 * belongs to.)
 */
export function financialTeamIds(
  teams: Array<{ id: string; role: Role }>,
): string[] {
  return teams.filter((t) => isTeamAdmin(t.role)).map((t) => t.id);
}

/**
 * Period the business landing page summarizes over.
 *
 * - `last12` (default) — rolling 12 months. Stable across Jan/Feb
 *   (the YTD trap personas flagged) and what most owners want at
 *   a glance.
 * - `ytd` — Jan 1 of the current calendar year through today.
 *   Useful for tax-prep at year-end; depressing on Jan 5.
 * - `month` — first of the current calendar month through today.
 *   Useful for AR / cashflow at month-end.
 *
 * Future-proof note: fiscal-year-end is on businesses table but
 * not yet honored here — when it lands, `ytd` should anchor on
 * fiscal year start, not Jan 1.
 */
export type Period = "last12" | "ytd" | "month";

export const PERIODS: Period[] = ["last12", "ytd", "month"];
export const DEFAULT_PERIOD: Period = "last12";

/** Parse a `?period=` URL param into a known Period, defaulting to
 *  `last12` for missing or unrecognized values. */
export function parsePeriod(raw: string | null | undefined): Period {
  if (raw === "ytd" || raw === "month" || raw === "last12") return raw;
  return DEFAULT_PERIOD;
}

/**
 * ISO 8601 (UTC) lower bound the chosen period starts from. Inclusive
 * — pass directly to `gte("paid_at", cutoff)` / `gte("incurred_on", cutoff.slice(0,10))`.
 *
 * Implementation notes:
 *   - All dates are computed in UTC. Until businesses surface a
 *     timezone preference this is the honest default — the user's
 *     browser local TZ would silently drift the period boundary.
 *   - `ytd` uses Jan 1 00:00 UTC of the current year.
 *   - `month` uses the 1st of the current month at 00:00 UTC.
 */
export function periodCutoff(period: Period, now: Date = new Date()): string {
  if (period === "ytd") {
    const jan1 = new Date(
      Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0),
    );
    return jan1.toISOString();
  }
  if (period === "month") {
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
    );
    return monthStart.toISOString();
  }
  // last12 — rolling 12 months ending now.
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 12);
  return cutoff.toISOString();
}

/**
 * Highest role across the viewer's memberships in a business.
 * `owner` > `admin` > `member`. Drives whether financial KPIs
 * render — a member-only viewer sees the card without the dollars.
 */
export function maxRole(roles: Role[]): Role {
  return roles.reduce<Role>((max, r) => {
    if (r === "owner") return "owner";
    if (r === "admin" && max !== "owner") return "admin";
    return max;
  }, "member");
}

/** A distinct business the viewer can access, for the landing redirect
 *  and the hub header switcher. */
export interface ViewerBusiness {
  /** business_id — anchor for /business/[id]. */
  id: string;
  /** Fallback display name (the alphabetically-first team's name) when
   *  the business has no legal_name set. */
  name: string;
  legalName: string | null;
}

/**
 * Group the viewer's teams into the distinct businesses they belong to,
 * sorted by display name (legal name if set, else the representative
 * team name). Pure so it's unit-testable; the async fetch wrapper lives
 * in `get-viewer-businesses.ts`.
 *
 * Teams whose `business_id` is null (legacy shells, shouldn't exist
 * post-migration) are skipped — without a business_id they can't anchor
 * a `/business/[id]` link.
 */
export function groupViewerBusinesses(
  teams: Array<{ id: string; name: string }>,
  teamBusiness: Array<{ id: string; business_id: string | null }>,
  businesses: Array<{ id: string; legal_name: string | null }>,
): ViewerBusiness[] {
  const businessIdByTeam = new Map(
    teamBusiness.map((r) => [r.id, r.business_id]),
  );
  const legalById = new Map(businesses.map((b) => [b.id, b.legal_name]));

  const teamNamesByBusiness = new Map<string, string[]>();
  for (const team of teams) {
    const bid = businessIdByTeam.get(team.id) ?? null;
    if (!bid) continue;
    const names = teamNamesByBusiness.get(bid) ?? [];
    names.push(team.name);
    teamNamesByBusiness.set(bid, names);
  }

  const out: ViewerBusiness[] = [];
  for (const [bid, names] of teamNamesByBusiness) {
    const representative =
      [...names].sort((a, b) => a.localeCompare(b))[0] ?? "";
    out.push({
      id: bid,
      name: representative,
      legalName: legalById.get(bid) ?? null,
    });
  }
  return out.sort((a, b) =>
    (a.legalName ?? a.name).localeCompare(b.legalName ?? b.name),
  );
}

/**
 * Sum amounts grouped by ISO 4217 currency code. Currency codes are
 * uppercased; a missing or null currency falls back to "USD" so
 * legacy rows from before the multi-currency migration don't get
 * orphaned into a "" bucket.
 */
export function groupByCurrency(
  rows: Array<{ amount: number | string | null; currency: string | null }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const code = (row.currency ?? "USD").toUpperCase();
    const amt = Number(row.amount ?? 0);
    out.set(code, (out.get(code) ?? 0) + amt);
  }
  return out;
}

/**
 * Decide whether Net is computable for a business. Net is only
 * meaningful when both Revenue and Expenses are in one currency
 * AND it's the same currency on both sides. Mixed-currency cards
 * surface a "see breakdown" message instead of a wrong number.
 */
export function netForBusiness(
  revenueByCurrency: Map<string, number>,
  expensesByCurrency: Map<string, number>,
): { amount: number; currency: string } | null {
  const all = new Set<string>([
    ...revenueByCurrency.keys(),
    ...expensesByCurrency.keys(),
  ]);
  if (all.size !== 1) return null;
  const currency = Array.from(all)[0]!;
  const revenue = revenueByCurrency.get(currency) ?? 0;
  const expenses = expensesByCurrency.get(currency) ?? 0;
  return { amount: revenue - expenses, currency };
}

export type NetClass = "profit" | "loss" | "breakEven";

/** Classify a Net amount with a half-cent tolerance, so float
 *  subtraction doesn't produce a `Loss · -$0.00` footgun. */
export function classifyNet(amount: number): NetClass {
  if (amount > 0.005) return "profit";
  if (amount < -0.005) return "loss";
  return "breakEven";
}

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

/**
 * Render an amount with an explicit leading +/− sign for non-zero
 * values. Zero (within the half-cent tolerance) renders without a
 * sign. The minus is U+2212 (mathematical minus) for visual weight.
 */
export function formatSignedCurrency(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  const formatted = formatCurrency(abs, currency);
  if (amount > 0.005) return `+${formatted}`;
  if (amount < -0.005) return `−${formatted}`;
  return formatted;
}

/** Sort a per-currency map into a stable display order (alpha by
 *  ISO code) so card-to-card comparison reads the same way. */
export function sortByCurrency(
  map: Map<string, number>,
): Array<[string, number]> {
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}
