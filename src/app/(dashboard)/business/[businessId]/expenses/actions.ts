"use server";

/**
 * Bulk expense server actions — multi-row operations behind the
 * bulk-select strip on /business/[businessId]/expenses. These are
 * Business-module glue (the bulk strip exists only on that surface)
 * so they stay in the module's route directory. The shared row-level
 * actions (create / update / split / delete / restore) live in the
 * neutral `@/lib/expenses/actions` home — see
 * docs/reference/modules.md.
 */

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { ALLOWED_EXPENSE_CATEGORIES } from "@/lib/expenses/allow-lists";
import { filterAuthorizedExpenseIds } from "./bulk-auth";
import { parseExpenseFilters } from "./filter-params";
import { applyExpenseFilters } from "./query-filters";
import { readFilterParamsFromFormData } from "./filter-formdata";
import { filterUninvoicedExpenseIds } from "@/lib/expenses/expense-lock-helpers";
import { revalidateProjectsForExpense } from "@/lib/expenses/revalidate";

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
