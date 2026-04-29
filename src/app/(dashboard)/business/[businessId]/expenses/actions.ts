"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { ALLOWED_EXPENSE_CATEGORIES } from "./allow-lists";
import { filterAuthorizedExpenseIds } from "./bulk-auth";

function blankToNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

interface ExpenseInput {
  incurred_on: string;
  amount: number;
  currency: string;
  vendor: string | null;
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
      const { data: row } = await supabase
        .from("expenses")
        .select("team_id, user_id")
        .eq("id", id)
        .maybeSingle();
      if (!row) throw new Error("Expense not found.");
      const { role } = await validateTeamAccess(row.team_id as string);
      const isAuthor = (row.user_id as string) === userId;
      if (!isAuthor && role !== "owner" && role !== "admin") {
        throw new Error("Only the author or an owner/admin can edit.");
      }

      const expense = readExpense(fd);

      assertSupabaseOk(
        await supabase.from("expenses").update(expense).eq("id", id),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
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
      // before letting RLS take over.
      const { data: row } = await supabase
        .from("expenses")
        .select("team_id, user_id")
        .eq("id", id)
        .maybeSingle();
      if (!row) throw new Error("Expense not found.");
      const { role } = await validateTeamAccess(row.team_id as string);
      const isAuthor = (row.user_id as string) === userId;
      if (!isAuthor && role !== "owner" && role !== "admin") {
        throw new Error("Only the author or an owner/admin can edit.");
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
    },
    "updateExpenseFieldAction",
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
        .select("team_id, user_id")
        .eq("id", id)
        .maybeSingle();
      if (!row) throw new Error("Expense not found.");
      const { role } = await validateTeamAccess(row.team_id as string);
      const isAuthor = (row.user_id as string) === userId;
      if (!isAuthor && role !== "owner" && role !== "admin") {
        throw new Error("Only the author or an owner/admin can delete.");
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
        .select("team_id, user_id, deleted_at")
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
 *  error message. */
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
      const ids = fd.getAll("id").map(String).filter(Boolean);
      const category = String(fd.get("category") ?? "").trim();
      if (ids.length === 0) throw new Error("No rows selected.");
      if (!ALLOWED_EXPENSE_CATEGORIES.has(category)) {
        throw new Error("Invalid category.");
      }

      const authorized = await authorizeExpenseBulk(supabase, ids, userId);
      if (authorized.length === 0) {
        throw new Error("None of the selected rows are editable.");
      }

      assertSupabaseOk(
        await supabase
          .from("expenses")
          .update({ category })
          .in("id", authorized),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
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
      const ids = fd.getAll("id").map(String).filter(Boolean);
      const rawProject = String(fd.get("project_id") ?? "").trim();
      if (ids.length === 0) throw new Error("No rows selected.");
      const projectId =
        rawProject === "" || rawProject === "none" ? null : rawProject;

      const authorized = await authorizeExpenseBulk(supabase, ids, userId);
      if (authorized.length === 0) {
        throw new Error("None of the selected rows are editable.");
      }

      assertSupabaseOk(
        await supabase
          .from("expenses")
          .update({ project_id: projectId })
          .in("id", authorized),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
    },
    "bulkUpdateExpenseProjectAction",
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
      const ids = fd.getAll("id").map(String).filter(Boolean);
      if (ids.length === 0) throw new Error("No rows selected.");

      const authorized = await authorizeExpenseBulk(supabase, ids, userId);
      if (authorized.length === 0) {
        throw new Error("None of the selected rows are deletable.");
      }

      assertSupabaseOk(
        await supabase
          .from("expenses")
          .update({ deleted_at: new Date().toISOString() })
          .in("id", authorized),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
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

      assertSupabaseOk(
        await supabase
          .from("expenses")
          .update({ deleted_at: null })
          .in("id", authorized),
      );

      revalidatePath("/business");
      revalidatePath("/business/expenses");
    },
    "bulkRestoreExpensesAction",
  );
}
