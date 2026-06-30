"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { ALLOWED_EXPENSE_CATEGORIES } from "./allow-lists";
import { filterAuthorizedExpenseIds } from "./bulk-auth";
import { validateSplits, type ExpenseSplit } from "./split-helpers";
import { parseExpenseFilters } from "./filter-params";
import { applyExpenseFilters } from "./query-filters";
import { readFilterParamsFromFormData } from "./filter-formdata";
import {
  filterUninvoicedExpenseIds,
  INVOICED_EDITABLE_EXPENSE_FIELDS,
} from "./expense-lock-helpers";

function blankToNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Revalidate the project detail page(s) for the affected expense
 *  rows. Project page renders its own expenses section sourced from
 *  the same table, so a mutation on the main /business/[id]/expenses
 *  surface would leave the project page stale without this. Pass the
 *  full list of project_ids that may have been touched (old + new for
 *  field updates that move an expense between projects); duplicates
 *  and nulls are filtered. */
function revalidateProjectsForExpense(
  projectIds: ReadonlyArray<string | null | undefined>,
): void {
  const distinct = new Set<string>();
  for (const id of projectIds) {
    if (id) distinct.add(id);
  }
  for (const id of distinct) {
    revalidatePath(`/projects/${id}`);
  }
}

interface ExpenseInput {
  incurred_on: string;
  amount: number;
  currency: string;
  vendor: string | null;
  external_reference: string | null;
  category: string;
  description: string | null;
  notes: string | null;
  project_id: string | null;
  billable: boolean;
}

function readExpense(formData: FormData): ExpenseInput {
  const incurred_on = blankToNull(formData.get("incurred_on"));
  if (!incurred_on || !/^\d{4}-\d{2}-\d{2}$/.test(incurred_on)) {
    throw new Error("Date (YYYY-MM-DD) is required.");
  }
  const amountStr = blankToNull(formData.get("amount"));
  if (!amountStr) throw new Error("Amount is required.");
  const amount = Number(amountStr);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Amount must be a non-negative number.");
  }
  const category = blankToNull(formData.get("category"));
  if (!category || !ALLOWED_EXPENSE_CATEGORIES.has(category)) {
    throw new Error("A valid category is required.");
  }
  const currency = blankToNull(formData.get("currency")) ?? "USD";
  const vendor = blankToNull(formData.get("vendor"));
  const external_reference = blankToNull(formData.get("external_reference"));
  const description = blankToNull(formData.get("description"));
  const notes = blankToNull(formData.get("notes"));
  const rawProjectId = blankToNull(formData.get("project_id"));
  const project_id = rawProjectId && rawProjectId !== "none" ? rawProjectId : null;
  const billable = formData.get("billable") === "on" || formData.get("billable") === "true";

  return {
    incurred_on,
    amount: Math.round(amount * 100) / 100,
    currency,
    vendor,
    external_reference,
    category,
    description,
    notes,
    project_id,
    billable,
  };
}

export async function createExpenseAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const teamId = String(fd.get("team_id") ?? "");
      await validateTeamAccess(teamId);
      const expense = readExpense(fd);

      assertSupabaseOk(
        await supabase.from("expenses").insert({
          user_id: userId,
          team_id: teamId,
          ...expense,
        }),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
      revalidateProjectsForExpense([expense.project_id]);
    },
    "createExpenseAction",
  );
}

export async function updateExpenseAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const id = String(fd.get("id") ?? "");
      if (!id) throw new Error("Expense id required.");

      // Defense-in-depth: fetch the row to confirm team + authorship
      // before relying on RLS. Same pattern used by SAL-011 invoice
      // status updates — verify role at the action layer so the user
      // gets a friendly error instead of an opaque RLS denial.
      // Also captures the existing project_id so the revalidate step
      // can flush both the old and new project detail pages on a
      // re-parenting update. `invoiced` is read here so a row that
      // has landed on an invoice can be locked from further edits
      // (mirrors the time_entries invoiced lock at SAL-008).
      const { data: row } = await supabase
        .from("expenses")
        .select("team_id, user_id, project_id, invoiced")
        .eq("id", id)
        .maybeSingle();
      if (!row) throw new Error("Expense not found.");
      const { role } = await validateTeamAccess(row.team_id as string);
      const isAuthor = (row.user_id as string) === userId;
      if (!isAuthor && role !== "owner" && role !== "admin") {
        throw new Error("Only the author or an owner/admin can edit.");
      }
      if (row.invoiced === true) {
        throw new Error(
          "This expense is on an invoice and is locked. Void the invoice first, or remove the expense from it.",
        );
      }

      const expense = readExpense(fd);

      assertSupabaseOk(
        await supabase.from("expenses").update(expense).eq("id", id),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
      revalidateProjectsForExpense([
        row.project_id as string | null,
        expense.project_id,
      ]);
    },
    "updateExpenseAction",
  );
}

/** Allowed field keys for the per-field update path. Tracked
 *  here as a Set instead of the type system so we can reject
 *  unknown keys at runtime — never trust the client. */
const EDITABLE_EXPENSE_FIELDS = new Set([
  "incurred_on",
  "amount",
  "vendor",
  "external_reference",
  "category",
  "description",
  "notes",
  "project_id",
  "billable",
]);

/**
 * Partial single-field update for in-cell editing on the expenses
 * table. Mirrors the auth + role gate of `updateExpenseAction` but
 * only writes one column at a time, validating the value
 * server-side per field.
 *
 * Form fields:
 *   - id     expense row id
 *   - field  one of EDITABLE_EXPENSE_FIELDS
 *   - value  the new value, as a string (parsed per field below)
 */
export async function updateExpenseFieldAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const id = String(fd.get("id") ?? "");
      const field = String(fd.get("field") ?? "");
      const rawValue = fd.get("value");
      if (!id) throw new Error("Expense id required.");
      if (!EDITABLE_EXPENSE_FIELDS.has(field)) {
        throw new Error(`Field "${field}" cannot be edited.`);
      }

      // Same defense-in-depth as the full update: read the row,
      // confirm the caller is author or owner|admin on its team
      // before letting RLS take over. project_id is read here too so
      // a project_id transition can revalidate both the old and the
      // new project detail pages below. `invoiced` is read so the
      // same lock as updateExpenseAction applies to per-field edits.
      const { data: row } = await supabase
        .from("expenses")
        .select("team_id, user_id, project_id, invoiced")
        .eq("id", id)
        .maybeSingle();
      if (!row) throw new Error("Expense not found.");
      const { role } = await validateTeamAccess(row.team_id as string);
      const isAuthor = (row.user_id as string) === userId;
      if (!isAuthor && role !== "owner" && role !== "admin") {
        throw new Error("Only the author or an owner/admin can edit.");
      }
      // Field-level lock: an invoiced expense's metadata
      // (external_reference / description / notes / vendor / category)
      // stays editable — the invoice snapshots the expense, so these
      // can't mutate the issued invoice. The financial fields it
      // depends on (amount, currency, incurred_on, project_id,
      // billable) stay locked. Mirrors the DB trigger's `meta`
      // strip-list (pinned by expense-lock-parity.test.ts); the trigger
      // is the authoritative boundary, this is defense-in-depth + a
      // clearer message.
      if (
        row.invoiced === true &&
        !INVOICED_EDITABLE_EXPENSE_FIELDS.has(field)
      ) {
        throw new Error(
          `"${field}" is locked while this expense is on an invoice. Void the invoice first, or remove the expense from it. Reference #, description, notes, vendor, and category stay editable.`,
        );
      }

      const update: Record<string, unknown> = {};
      const valueStr = typeof rawValue === "string" ? rawValue.trim() : "";

      switch (field) {
        case "incurred_on": {
          if (!valueStr || !/^\d{4}-\d{2}-\d{2}$/.test(valueStr)) {
            throw new Error("Date must be YYYY-MM-DD.");
          }
          update.incurred_on = valueStr;
          break;
        }
        case "amount": {
          const n = Number(valueStr);
          if (!Number.isFinite(n) || n < 0) {
            throw new Error("Amount must be a non-negative number.");
          }
          update.amount = Math.round(n * 100) / 100;
          break;
        }
        case "category": {
          if (!valueStr || !ALLOWED_EXPENSE_CATEGORIES.has(valueStr)) {
            throw new Error("Invalid category.");
          }
          update.category = valueStr;
          break;
        }
        case "vendor":
        case "external_reference":
        case "description":
        case "notes": {
          update[field] = valueStr === "" ? null : valueStr;
          break;
        }
        case "project_id": {
          // "" or "none" → clear the link.
          update.project_id =
            valueStr === "" || valueStr === "none" ? null : valueStr;
          break;
        }
        case "billable": {
          update.billable = valueStr === "true" || valueStr === "on";
          break;
        }
        default:
          // Unreachable — guarded by the Set above. Defensive throw
          // so a future EDITABLE_EXPENSE_FIELDS addition without a
          // matching switch arm fails loudly in dev.
          throw new Error(`Unhandled editable field: ${field}`);
      }

      assertSupabaseOk(
        await supabase.from("expenses").update(update).eq("id", id),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
      // Touch both the old and the (possibly-new) project page —
      // project_id is the only field whose update can land an
      // expense on a different project's surface than where it was
      // before. For non-project_id fields the second entry will
      // dedupe against the first inside the helper.
      revalidateProjectsForExpense([
        row.project_id as string | null,
        field === "project_id"
          ? (update.project_id as string | null | undefined)
          : (row.project_id as string | null),
      ]);
    },
    "updateExpenseFieldAction",
  );
}

/**
 * Split one expense into N rows, one per category. The original
 * row stays put — its amount + category + notes get rewritten to
 * splits[0]; rows for splits[1..N-1] are inserted alongside,
 * inheriting everything else from the original (date, vendor,
 * project, billable, currency, team, user_id).
 *
 * Auth gate matches updateExpenseAction (author OR owner|admin).
 *
 * import_source_id and import_run_id are intentionally NOT
 * copied to the new rows: the user split this manually after
 * import, so the new rows aren't part of the import for
 * dedupe / undo purposes. The original keeps its source_id +
 * run_id so re-imports still dedupe against the original
 * receipt.
 *
 * Form fields:
 *   - id           expense to split
 *   - splits       JSON array of { amount, category, notes? }
 */
export async function splitExpenseAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const id = String(fd.get("id") ?? "");
      const splitsJson = String(fd.get("splits") ?? "");
      if (!id) throw new Error("Expense id required.");
      if (!splitsJson) throw new Error("Splits payload required.");

      let splits: ExpenseSplit[];
      try {
        const parsed = JSON.parse(splitsJson);
        if (!Array.isArray(parsed)) {
          throw new Error("Splits must be an array.");
        }
        splits = parsed.map((s, i) => {
          if (typeof s !== "object" || s === null) {
            throw new Error(`Split ${i} is not an object.`);
          }
          const amt = Number(
            (s as { amount: unknown }).amount,
          );
          const category = String(
            (s as { category: unknown }).category ?? "",
          );
          const rawNotes = (s as { notes: unknown }).notes;
          const notes =
            typeof rawNotes === "string" && rawNotes.trim() !== ""
              ? rawNotes.trim()
              : null;
          return { amount: amt, category, notes };
        });
      } catch (err) {
        throw new Error(
          `Splits payload is invalid: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Auth + load original.
      const { data: original } = await supabase
        .from("expenses")
        .select(
          "id, team_id, user_id, incurred_on, amount, currency, vendor, external_reference, description, notes, project_id, billable, deleted_at, invoiced",
        )
        .eq("id", id)
        .maybeSingle();
      if (!original) throw new Error("Expense not found.");
      if (original.deleted_at) {
        throw new Error("Cannot split a deleted expense.");
      }
      if (original.invoiced === true) {
        throw new Error(
          "This expense is on an invoice and is locked. Void the invoice first, or remove the expense from it.",
        );
      }
      const teamId = original.team_id as string;
      const { role } = await validateTeamAccess(teamId);
      const isAuthor = (original.user_id as string) === userId;
      if (!isAuthor && role !== "owner" && role !== "admin") {
        throw new Error("Only the author or an owner/admin can split.");
      }

      // Validate splits sum + per-row.
      const originalAmount = Number(original.amount);
      const validation = validateSplits(originalAmount, splits);
      if (!validation.ok) {
        throw new Error(
          validation.summary ??
            "Some splits are invalid — please fix and try again.",
        );
      }

      // Update the original to splits[0] values. Preserve the
      // original notes on splits[0] when the user didn't supply
      // an override, so the split that "is the original" doesn't
      // silently lose its audit trail.
      const first = splits[0]!;
      assertSupabaseOk(
        await supabase
          .from("expenses")
          .update({
            amount: Math.round(first.amount * 100) / 100,
            category: first.category,
            notes:
              first.notes !== null && first.notes !== undefined
                ? first.notes
                : (original.notes as string | null),
          })
          .eq("id", id),
      );

      // Insert the remaining splits as new rows. Inherit the
      // original's date, vendor, external_reference, description,
      // project, billable, currency, team, user — only amount +
      // category + notes are split-specific.
      if (splits.length > 1) {
        const newRows = splits.slice(1).map((s) => ({
          team_id: teamId,
          user_id: original.user_id as string,
          incurred_on: original.incurred_on as string,
          amount: Math.round(s.amount * 100) / 100,
          currency: (original.currency as string | null) ?? "USD",
          vendor: original.vendor as string | null,
          external_reference: original.external_reference as string | null,
          category: s.category,
          description: original.description as string | null,
          notes: s.notes ?? null,
          project_id: (original.project_id as string | null) ?? null,
          billable: original.billable as boolean,
        }));
        assertSupabaseOk(
          await supabase.from("expenses").insert(newRows),
        );
      }

      revalidatePath("/business");
      revalidatePath("/business/expenses");
      // Splits inherit the original's project_id, so a single
      // revalidation covers every row produced by this action.
      revalidateProjectsForExpense([original.project_id as string | null]);
    },
    "splitExpenseAction",
  );
}

export async function deleteExpenseAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const id = String(fd.get("id") ?? "");
      if (!id) throw new Error("Expense id required.");

      const { data: row } = await supabase
        .from("expenses")
        .select("team_id, user_id, project_id, invoiced")
        .eq("id", id)
        .maybeSingle();
      if (!row) throw new Error("Expense not found.");
      const { role } = await validateTeamAccess(row.team_id as string);
      const isAuthor = (row.user_id as string) === userId;
      if (!isAuthor && role !== "owner" && role !== "admin") {
        throw new Error("Only the author or an owner/admin can delete.");
      }
      if (row.invoiced === true) {
        // Deleting an invoiced expense would silently null its FK on
        // the invoice line item (ON DELETE SET NULL) and leave the
        // line orphaned. Force the user through the void-invoice
        // path so the reconciliation trail stays honest.
        throw new Error(
          "This expense is on an invoice and is locked. Void the invoice first, or remove the expense from it.",
        );
      }

      // Soft-delete: time_entries pattern. Period-lock trigger
      // still fires on UPDATE that touches incurred_on, so a
      // locked-period row can't be soft-deleted-and-moved either.
      assertSupabaseOk(
        await supabase
          .from("expenses")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", id),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
      revalidateProjectsForExpense([row.project_id as string | null]);
    },
    "deleteExpenseAction",
  );
}

/**
 * Restore a soft-deleted expense by setting `deleted_at = NULL`.
 * Used by the Undo toast and the /trash surface. Same role gate
 * as delete: author OR owner/admin.
 */
export async function restoreExpenseAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const id = String(fd.get("id") ?? "");
      if (!id) throw new Error("Expense id required.");

      const { data: row } = await supabase
        .from("expenses")
        .select("team_id, user_id, deleted_at, project_id")
        .eq("id", id)
        .maybeSingle();
      if (!row) throw new Error("Expense not found.");
      if (!row.deleted_at) {
        // Idempotent — already restored.
        return;
      }
      const { role } = await validateTeamAccess(row.team_id as string);
      const isAuthor = (row.user_id as string) === userId;
      if (!isAuthor && role !== "owner" && role !== "admin") {
        throw new Error("Only the author or an owner/admin can restore.");
      }

      assertSupabaseOk(
        await supabase
          .from("expenses")
          .update({ deleted_at: null })
          .eq("id", id),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
      revalidateProjectsForExpense([row.project_id as string | null]);
    },
    "restoreExpenseAction",
  );
}

// ────────────────────────────────────────────────────────────────
// Bulk actions — multi-row operations from the table's selection
// toolbar. All scoped per-row by id; the action layer fetches each
// row to verify (team_id, user_id) and enforces the same auth gate
// as the per-row variants. RLS does the same at the DB layer; the
// app-layer pre-check is for friendly "you can't edit row X"
// messages instead of opaque permission errors mid-batch.
// ────────────────────────────────────────────────────────────────

/** Read every expense's (team_id, user_id) in one bulk query and
 *  filter to ids the caller is authorized to mutate. Returns the
 *  authorized id list — anything filtered out fails silently as
 *  the per-row RLS would have blocked the write anyway, and we
 *  don't want to leak existence of rows in other teams via an
 *  error message.
 *
 *  ─────────────────────────────────────────────────────────────
 *  Scope resolution: bulk actions accept either an explicit ID
 *  list (default, from `fd.getAll("id")`) OR a filter spec
 *  (`scope=filters` + `filter_*` params + `businessId`). The
 *  filter path lets the table's "Select all N matching" CTA hit
 *  every row matching the user's current filter, even rows that
 *  pagination hasn't loaded yet. Both paths funnel into
 *  authorizeExpenseBulk so the per-row role check is the single
 *  gate against unauthorized writes. */
async function resolveAuthorizedExpenseIds(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  fd: FormData,
  callerUserId: string,
): Promise<string[]> {
  const scope = String(fd.get("scope") ?? "ids");

  if (scope === "filters") {
    const businessId = String(fd.get("businessId") ?? "").trim();
    if (!businessId) {
      throw new Error("businessId is required for filter-scope bulk.");
    }

    // Reuse the same parser the list page uses so any drift
    // between the visible set and the bulk-action set is a type
    // error, not a silent runtime mismatch. The FormData→raw step
    // is shared with the client (`filter-formdata.ts`) so the
    // round-trip is unit-tested in one place.
    const filters = parseExpenseFilters(readFilterParamsFromFormData(fd));

    // Resolve viewer's accessible teams in the business — same
    // chain as page.tsx so filter-scope bulk operates on exactly
    // the same row universe the user sees in the list.
    const { data: tmRows } = await supabase
      .from("team_members")
      .select("team_id")
      .eq("user_id", callerUserId);
    const userTeamIds = (tmRows ?? []).map((r) => r.team_id as string);
    if (userTeamIds.length === 0) return [];

    const { data: businessTeams } = await supabase
      .from("teams")
      .select("id")
      .eq("business_id", businessId)
      .in("id", userTeamIds);
    const teamIds = (businessTeams ?? []).map((r) => r.id as string);
    if (teamIds.length === 0) return [];

    const baseQuery = supabase
      .from("expenses")
      .select("id")
      .in("team_id", teamIds)
      .is("deleted_at", null);
    const filteredQuery = applyExpenseFilters(baseQuery, filters);
    const { data: matchRows } = await filteredQuery;
    const ids = (matchRows ?? []).map((r) => r.id as string);
    if (ids.length === 0) return [];
    return authorizeExpenseBulk(supabase, ids, callerUserId);
  }

  const ids = fd.getAll("id").map(String).filter(Boolean);
  if (ids.length === 0) return [];
  return authorizeExpenseBulk(supabase, ids, callerUserId);
}

/** Fetch the project_ids for a list of expense ids. Used by the
 *  bulk action revalidate step so every project page that hosts at
 *  least one of the affected expenses gets flushed. Returns only
 *  non-null project_ids — expenses without a project link can't
 *  appear on any /projects/* page. */
async function projectIdsForExpenses(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("expenses")
    .select("project_id")
    .in("id", ids);
  return (data ?? [])
    .map((r) => r.project_id as string | null)
    .filter((id): id is string => !!id);
}

// `filterUninvoicedExpenseIds` lives in expense-lock-helpers.ts so
// it can be unit-tested without the "use server" network boundary.
// Imported at top of file.

async function authorizeExpenseBulk(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  ids: readonly string[],
  callerUserId: string,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data: rows } = await supabase
    .from("expenses")
    .select("id, team_id, user_id")
    .in("id", ids);
  if (!rows || rows.length === 0) return [];

  const teamIds = Array.from(
    new Set(rows.map((r) => r.team_id as string)),
  );
  // Role per team — owner/admin can mutate any row in their team;
  // members can only mutate rows they authored. Cache via map so
  // multi-row in the same team only validates once.
  const roleByTeam = new Map<string, string>();
  for (const teamId of teamIds) {
    const { role } = await validateTeamAccess(teamId);
    roleByTeam.set(teamId, role);
  }

  return filterAuthorizedExpenseIds(
    rows.map((r) => ({
      id: r.id as string,
      team_id: r.team_id as string,
      user_id: r.user_id as string,
    })),
    callerUserId,
    roleByTeam,
  );
}

/** Bulk-update category on N expenses. */
export async function bulkUpdateExpenseCategoryAction(
  formData: FormData,
): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const category = String(fd.get("category") ?? "").trim();
      if (!ALLOWED_EXPENSE_CATEGORIES.has(category)) {
        throw new Error("Invalid category.");
      }

      const authorized = await resolveAuthorizedExpenseIds(
        supabase,
        fd,
        userId,
      );
      if (authorized.length === 0) {
        throw new Error("None of the selected rows are editable.");
      }

      const writable = await filterUninvoicedExpenseIds(supabase, authorized);
      if (writable.length === 0) {
        throw new Error(
          "All selected rows are locked because they're on an invoice. Void the invoice first.",
        );
      }

      const projectIds = await projectIdsForExpenses(supabase, writable);

      assertSupabaseOk(
        await supabase
          .from("expenses")
          .update({ category })
          .in("id", writable),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
      revalidateProjectsForExpense(projectIds);
    },
    "bulkUpdateExpenseCategoryAction",
  );
}

/** Bulk-update project_id on N expenses. Empty string / "none"
 *  clears the link. */
export async function bulkUpdateExpenseProjectAction(
  formData: FormData,
): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const rawProject = String(fd.get("project_id") ?? "").trim();
      const projectId =
        rawProject === "" || rawProject === "none" ? null : rawProject;

      const authorized = await resolveAuthorizedExpenseIds(
        supabase,
        fd,
        userId,
      );
      if (authorized.length === 0) {
        throw new Error("None of the selected rows are editable.");
      }

      const writable = await filterUninvoicedExpenseIds(supabase, authorized);
      if (writable.length === 0) {
        throw new Error(
          "All selected rows are locked because they're on an invoice. Void the invoice first.",
        );
      }

      // Capture every project_id BEFORE the update so we can flush
      // the project pages the affected rows are about to leave. The
      // new projectId (if any) is added below so its page picks up
      // the row right away.
      const oldProjectIds = await projectIdsForExpenses(supabase, writable);

      assertSupabaseOk(
        await supabase
          .from("expenses")
          .update({ project_id: projectId })
          .in("id", writable),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
      revalidateProjectsForExpense([...oldProjectIds, projectId]);
    },
    "bulkUpdateExpenseProjectAction",
  );
}

/**
 * Bulk-set the `billable` flag on N expenses. Three legal payload
 * shapes match the per-row inline edit:
 *   - "true"   → billable=true
 *   - "false"  → billable=false
 *   - ""       → billable=null (clear / unset; downstream rules
 *                 re-apply when relevant)
 *
 * Reuses `resolveAuthorizedExpenseIds` so RLS-filtered ids are the
 * only ones written, exactly like the category / project bulk
 * actions. Surfaces `bulkUpdateExpenseBillableAction` as the
 * default export name to mirror those siblings.
 */
export async function bulkUpdateExpenseBillableAction(
  formData: FormData,
): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const raw = String(fd.get("billable") ?? "").trim();
      let billable: boolean | null;
      if (raw === "true") billable = true;
      else if (raw === "false") billable = false;
      else if (raw === "") billable = null;
      else throw new Error(`Invalid billable value: ${raw}`);

      const authorized = await resolveAuthorizedExpenseIds(
        supabase,
        fd,
        userId,
      );
      if (authorized.length === 0) {
        throw new Error("None of the selected rows are editable.");
      }

      const writable = await filterUninvoicedExpenseIds(supabase, authorized);
      if (writable.length === 0) {
        throw new Error(
          "All selected rows are locked because they're on an invoice. Void the invoice first.",
        );
      }

      const projectIds = await projectIdsForExpenses(supabase, writable);

      assertSupabaseOk(
        await supabase
          .from("expenses")
          .update({ billable })
          .in("id", writable),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
      revalidateProjectsForExpense(projectIds);
    },
    "bulkUpdateExpenseBillableAction",
  );
}

/** Bulk soft-delete N expenses. Mirror of single-row delete: sets
 *  deleted_at = now() so the Undo toast can restore them. */
export async function bulkDeleteExpensesAction(
  formData: FormData,
): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const authorized = await resolveAuthorizedExpenseIds(
        supabase,
        fd,
        userId,
      );
      if (authorized.length === 0) {
        throw new Error("None of the selected rows are deletable.");
      }

      const writable = await filterUninvoicedExpenseIds(supabase, authorized);
      if (writable.length === 0) {
        throw new Error(
          "All selected rows are on an invoice and cannot be deleted. Void the invoice first.",
        );
      }

      const projectIds = await projectIdsForExpenses(supabase, writable);

      assertSupabaseOk(
        await supabase
          .from("expenses")
          .update({ deleted_at: new Date().toISOString() })
          .in("id", writable),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
      revalidateProjectsForExpense(projectIds);
    },
    "bulkDeleteExpensesAction",
  );
}

/** Bulk restore N expenses (Undo from the bulk-delete toast). */
export async function bulkRestoreExpensesAction(
  formData: FormData,
): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const ids = fd.getAll("id").map(String).filter(Boolean);
      if (ids.length === 0) throw new Error("No rows specified.");

      const authorized = await authorizeExpenseBulk(supabase, ids, userId);
      if (authorized.length === 0) return;

      const projectIds = await projectIdsForExpenses(supabase, authorized);

      assertSupabaseOk(
        await supabase
          .from("expenses")
          .update({ deleted_at: null })
          .in("id", authorized),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
      revalidateProjectsForExpense(projectIds);
    },
    "bulkRestoreExpensesAction",
  );
}
