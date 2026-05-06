/**
 * Tiny, dependency-free CSV helpers for exporting time entries.
 *
 * All clock-times are UTC. The `Date`, `Start`, and `End` columns
 * use UTC accessors so the export is identical no matter what
 * region the deploy runs in (Vercel can change regions mid-month
 * and silently shift dates if we used local-clock formatting).
 * The `Start (UTC)` and `End (UTC)` columns carry the full
 * ISO 8601 timestamp for unambiguous reconciliation.
 *
 * The trailing identifier columns (entry_id, user_id, team_id,
 * project_id, customer_id, invoice_id, invoiced) let bookkeepers
 * tie each row back to a database record — without them, an
 * exported CSV is opaque at audit time.
 */

export interface CsvEntryRow {
  date: string;
  start: string;
  end: string;
  durationMin: number | null;
  project: string;
  client: string;
  category: string;
  /** Name of the `category_set` the category belongs to (e.g.
   *  "Software development", "Consulting Phase 2"). Surfaces the
   *  full taxonomy chain so a reviewer reading historical entries
   *  sees which classification system each line was logged under —
   *  matters when a project's category_set_id has changed since the
   *  entry was logged (the project's current set isn't necessarily
   *  the set the row's category came from). Empty when the entry
   *  has no category. */
  categorySet: string;
  /** Period type (`weekly` / `monthly` / `quarterly`) on the
   *  project at the time of export. Empty when the project has no
   *  recurring cap. Surfaces with the cap below so a reviewer
   *  reconciling the CSV against the in-app burn bar sees both
   *  numbers. */
  periodBudgetPeriod: string;
  /** Project's hours-per-period cap. Empty when none set. */
  periodBudgetHoursCap: string;
  /** Project's dollars-per-period cap. Empty when none set or when
   *  the caller can't see rate-adjacent fields (RLS). */
  periodBudgetDollarsCap: string;
  description: string;
  billable: boolean;
  /** Legacy GitHub-only column. Populated for both old data
   *  (github_issue integer) and new data when the linked ticket is a
   *  GitHub issue. Kept for backward compat with bookkeeper CSV
   *  templates that already key off this column. */
  githubIssue: number | null;
  /** Full ticket key — e.g. "AE-640" (Jira) or "owner/repo#42"
   *  (GitHub). NULL when no ticket is linked. */
  ticketKey: string;
  /** Provider — "jira", "github", or "" when no ticket is linked. */
  ticketProvider: string;
  startIso: string;
  endIso: string;
  entryId: string;
  userId: string;
  userName: string;
  teamId: string;
  projectId: string;
  customerId: string;
  invoiceId: string;
  invoiced: boolean;
}

/**
 * RFC 4180 CSV field escaping:
 * - Wrap in double quotes if the field contains a comma, quote, or newline
 * - Escape embedded quotes by doubling them
 */
export function escapeCsvField(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const HEADERS: Array<keyof CsvEntryRow> = [
  "date",
  "start",
  "end",
  "durationMin",
  "project",
  "client",
  "category",
  "categorySet",
  "periodBudgetPeriod",
  "periodBudgetHoursCap",
  "periodBudgetDollarsCap",
  "description",
  "billable",
  "githubIssue",
  "ticketKey",
  "ticketProvider",
  "startIso",
  "endIso",
  "entryId",
  "userId",
  "userName",
  "teamId",
  "projectId",
  "customerId",
  "invoiceId",
  "invoiced",
];

const HEADER_LABELS: Record<keyof CsvEntryRow, string> = {
  date: "Date (UTC)",
  start: "Start (UTC)",
  end: "End (UTC)",
  durationMin: "Duration (min)",
  project: "Project",
  client: "Client",
  category: "Category",
  categorySet: "Category Set",
  periodBudgetPeriod: "Period Budget Type",
  periodBudgetHoursCap: "Period Budget Hours Cap",
  periodBudgetDollarsCap: "Period Budget Dollars Cap",
  description: "Description",
  billable: "Billable",
  githubIssue: "GitHub Issue",
  ticketKey: "Ticket Key",
  ticketProvider: "Ticket Provider",
  startIso: "Start ISO 8601",
  endIso: "End ISO 8601",
  entryId: "Entry ID",
  userId: "User ID",
  userName: "User",
  teamId: "Team ID",
  projectId: "Project ID",
  customerId: "Customer ID",
  invoiceId: "Invoice ID",
  invoiced: "Invoiced",
};

/**
 * Serialize rows into CSV text. Always uses \r\n line endings per RFC.
 */
export function toCsv(rows: CsvEntryRow[]): string {
  const headerLine = HEADERS.map((h) => escapeCsvField(HEADER_LABELS[h])).join(",");
  const lines = rows.map((row) =>
    HEADERS.map((h) => escapeCsvField(row[h])).join(","),
  );
  return [headerLine, ...lines].join("\r\n") + "\r\n";
}
