"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { ALLOWED_EXPENSE_CATEGORIES } from "./allow-lists";

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
