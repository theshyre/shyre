/**
 * Pure parser for expense list filter URL params. The expenses
 * page is server-rendered with searchParams; this helper turns
 * the raw `?q=…&year=…&category=…` shape into a normalized
 * `ExpenseFilters` object the page (and its tests) can use
 * without re-implementing the parsing per call site.
 *
 * Keep this file Supabase-free + framework-free — that's the
 * whole point. Server-side query construction lives in the page;
 * client-side URL update logic lives in the filter bar.
 */
import { ALLOWED_EXPENSE_CATEGORIES } from "./allow-lists";

export interface ExpenseFilters {
  /** Free-text substring match against vendor / description / notes.
   *  Empty string when no search is active. */
  q: string;
  /** Lower bound, YYYY-MM-DD inclusive. Null when not set. */
  from: string | null;
  /** Upper bound, YYYY-MM-DD inclusive. Null when not set. */
  to: string | null;
  /** Categories to include. Empty array means "all categories." */
  categories: string[];
  /** Project filter:
   *   - null         → no project filter active (show everything)
   *   - "none"       → only show rows with project_id IS NULL
   *   - any UUID     → only show rows whose project_id = this id */
  project: string | null;
  /** Billable filter:
   *   - null         → no billable filter active
   *   - true         → billable=true rows only
   *   - false        → billable=false rows only */
  billable: boolean | null;
}

export function emptyExpenseFilters(): ExpenseFilters {
  return {
    q: "",
    from: null,
    to: null,
    categories: [],
    project: null,
    billable: null,
  };
}

/** Parse the raw searchParams object Next 16 hands the page.
 *  Tolerant: rejects malformed values silently rather than
 *  throwing, since URL params come from arbitrary callers (a
 *  bookmarked link from last year, an external paste). The page
 *  defaults to no-filter when an entry is malformed. */
export function parseExpenseFilters(
  raw: Record<string, string | string[] | undefined>,
): ExpenseFilters {
  const out = emptyExpenseFilters();

  out.q = readString(raw.q);

  // Year shortcut → from/to range. `?year=2019` becomes
  // 2019-01-01 to 2019-12-31. Explicit from/to override year if
  // both are present (advanced user explicitly narrowed).
  const year = readYear(raw.year);
  if (year !== null) {
    out.from = `${year}-01-01`;
    out.to = `${year}-12-31`;
  }
  const from = readDate(raw.from);
  const to = readDate(raw.to);
  if (from) out.from = from;
  if (to) out.to = to;

  out.categories = readCategoryList(raw.category);

  const project = readString(raw.project).trim();
  if (project === "none") {
    out.project = "none";
  } else if (project !== "" && /^[0-9a-f-]{8,}$/i.test(project)) {
    out.project = project;
  }

  const billable = readString(raw.billable).trim().toLowerCase();
  if (billable === "true") out.billable = true;
  else if (billable === "false") out.billable = false;

  return out;
}

/** Derive the year-dropdown value from a filters object. Returns
 *  the YYYY string when from/to span exactly Jan 1 → Dec 31 of a
 *  single year; empty string otherwise (custom range or no
 *  date filter). Pure helper so the filter bar's render logic
 *  stays simple. */
export function deriveYearValue(f: ExpenseFilters): string {
  if (!f.from || !f.to) return "";
  const m = /^(\d{4})-01-01$/.exec(f.from);
  if (!m || !m[1]) return "";
  const year = m[1];
  if (f.to !== `${year}-12-31`) return "";
  return year;
}

/** True when the user has a date filter active that doesn't fit
 *  the year shortcut — i.e., they've used the custom range
 *  pickers. Drives the "More filters" disclosure's default-open
 *  state. */
export function isCustomDateRange(f: ExpenseFilters): boolean {
  if (deriveYearValue(f) !== "") return false;
  return f.from !== null || f.to !== null;
}

/** True iff at least one filter narrows the result set. Used to
 *  show / hide the "Active filters" chip row + the "Clear all"
 *  button. */
export function hasActiveFilters(f: ExpenseFilters): boolean {
  return (
    f.q !== "" ||
    f.from !== null ||
    f.to !== null ||
    f.categories.length > 0 ||
    f.project !== null ||
    f.billable !== null
  );
}

// ─────────────────────────────────────────────────────────────
// Filter mutators — pure transforms on ExpenseFilters. Hoisted
// out of the filter-bar component so the same logic runs from
// both the dropdowns AND the per-chip remove buttons in the
// "Active filters" row, plus they're cheap to unit-test.
// ─────────────────────────────────────────────────────────────

/** Apply / clear the year shortcut. Empty year clears `from`/`to`. */
export function applyYearShortcut(
  f: ExpenseFilters,
  year: string,
): ExpenseFilters {
  if (year === "") return { ...f, from: null, to: null };
  return {
    ...f,
    from: `${year}-01-01`,
    to: `${year}-12-31`,
  };
}

/** Toggle a single category in/out of the active set. Unknown
 *  categories are ignored (defensive — chip click should never
 *  produce a bogus value, but a malicious URL could). */
export function toggleCategory(
  f: ExpenseFilters,
  category: string,
): ExpenseFilters {
  if (!ALLOWED_EXPENSE_CATEGORIES.has(category)) return f;
  const next = new Set(f.categories);
  if (next.has(category)) next.delete(category);
  else next.add(category);
  return { ...f, categories: Array.from(next) };
}

/** Set the project filter. Empty string clears, "none" filters
 *  to unassigned, anything else is treated as a project id. */
export function applyProjectFilter(
  f: ExpenseFilters,
  project: string,
): ExpenseFilters {
  if (project === "") return { ...f, project: null };
  return { ...f, project };
}

/** Set the billable filter. "true"/"false" strings, anything else
 *  clears the filter. */
export function applyBillableFilter(
  f: ExpenseFilters,
  raw: string,
): ExpenseFilters {
  return {
    ...f,
    billable: raw === "true" ? true : raw === "false" ? false : null,
  };
}

/** Serialize back to a URLSearchParams instance for `router.replace`
 *  on the client. Empty / null fields are omitted so the URL stays
 *  clean (?from=… not ?from=&to=…). */
export function buildExpenseFilterParams(
  f: ExpenseFilters,
): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.from) sp.set("from", f.from);
  if (f.to) sp.set("to", f.to);
  if (f.categories.length > 0) sp.set("category", f.categories.join(","));
  if (f.project !== null) sp.set("project", f.project);
  if (f.billable !== null) sp.set("billable", String(f.billable));
  return sp;
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

function readString(v: string | string[] | undefined): string {
  if (v === undefined) return "";
  if (Array.isArray(v)) return v[0] ?? "";
  return v;
}

function readYear(v: string | string[] | undefined): number | null {
  const s = readString(v).trim();
  if (!/^\d{4}$/.test(s)) return null;
  const n = Number(s);
  if (n < 1900 || n > 9999) return null;
  return n;
}

function readDate(v: string | string[] | undefined): string | null {
  const s = readString(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  // Defensive validity round-trip.
  const [y, m, d] = s.split("-").map(Number);
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > 31
  ) {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return s;
}

function readCategoryList(
  v: string | string[] | undefined,
): string[] {
  // Accept both `?category=other,software` AND `?category=other&category=software`.
  const flat = Array.isArray(v) ? v.join(",") : (v ?? "");
  if (!flat) return [];
  const tokens = flat
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "" && ALLOWED_EXPENSE_CATEGORIES.has(t));
  // Stable, case-insensitive de-dupe.
  return Array.from(new Set(tokens));
}
