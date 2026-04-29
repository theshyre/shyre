"use server";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { toAppError, type SerializedAppError } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_IMPORTED_CATEGORY,
  EXPENSE_CSV_SOURCE,
  parseExpenseCsv,
  type ParsedExpenseRow,
} from "@/lib/expense-csv-import";

const BATCH_SIZE = 100;

interface ExpenseImportSummary {
  /** Top-level imported counts. Shape mirrors the Harvest importer's
   *  summary so the existing /import history `buildCountsList` reads
   *  this without a special case. */
  imported: {
    expenses: number;
  };
  /** Per-row imported count surfaced directly to the UI's success
   *  view. Same value as `imported.expenses` — duplicated so the
   *  client doesn't have to dig into the nested shape. */
  importedCount: number;
  skipped: number;
  /** Per-row parse failures with reasons. The CSV is what the user
   *  sees, so they can fix and re-upload — no need to surface raw
   *  rows back. */
  skippedReasons: Array<{ rowNumber: number; reason: string }>;
  /** Rows the parser produced but that the DB rejected as duplicates
   *  via the partial unique index. Counted separately so a re-run
   *  reads "X already imported" instead of "X failed." */
  alreadyImported: number;
  /** Per-batch insert errors (not duplicates). Should be rare. */
  errors: string[];
  importRunId: string;
  defaultCategory: typeof DEFAULT_IMPORTED_CATEGORY;
}

export interface ExpenseImportActionResult {
  success: true;
  summary: ExpenseImportSummary;
}

/**
 * Import expenses from a CSV. The shape is defined by parseExpenseCsv
 * (Date / Amount / Item / Comments — see source spreadsheet headers).
 *
 * Form fields:
 *   - team_id        target team to charge expenses to (owner|admin)
 *   - csv            raw CSV text
 *
 * Idempotency: each row gets a deterministic import_source_id; the
 * partial unique index (team_id, imported_from, import_source_id) on
 * the expenses table makes re-uploads of the same CSV (or a re-run
 * after a network failure) no-op the duplicates rather than
 * throwing. Conflict rows are counted as "already imported," not
 * skipped or errored — the user-facing summary distinguishes them.
 *
 * Doesn't go through `runSafeAction` because that wrapper's contract
 * returns `{ success: true } | { success: false; error }` with no
 * slot for a payload — and this action's whole point is to return
 * the per-row summary so the UI can render counts inline. We do the
 * auth check + error logging inline instead.
 */
export async function importExpensesCsvAction(
  formData: FormData,
): Promise<ExpenseImportActionResult | { success: false; error: SerializedAppError }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return failure(new Error("Unauthorized"), {});
  }

  const teamId = String(formData.get("team_id") ?? "");
  const csv = String(formData.get("csv") ?? "");

  try {
    if (!teamId) throw new Error("team_id is required.");
    if (!csv.trim()) throw new Error("CSV body is required.");

    const { role } = await validateTeamAccess(teamId);
    if (role !== "owner" && role !== "admin") {
      throw new Error("Only team owners and admins can run imports.");
    }

    const parseResult = parseExpenseCsv(csv);
    const parseSkipReasons = parseResult.skipped.map((s) => ({
      rowNumber: s.rowNumber,
      reason: s.reason,
    }));

    // Record the run upfront so a mid-import failure still leaves a
    // trace in /import history. Same pattern as the Harvest import
    // route.
    const importRunId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const { error: runInsertError } = await supabase
      .from("import_runs")
      .insert({
        id: importRunId,
        team_id: teamId,
        triggered_by_user_id: user.id,
        imported_from: EXPENSE_CSV_SOURCE,
        source_account_identifier: null,
        started_at: startedAt,
        status: "running",
      });
    if (runInsertError) {
      throw new Error(
        `Could not record import run: ${runInsertError.message}`,
      );
    }

    let imported = 0;
    let alreadyImported = 0;
    const errors: string[] = [];

    try {
      for (let i = 0; i < parseResult.rows.length; i += BATCH_SIZE) {
        const batch = parseResult.rows.slice(i, i + BATCH_SIZE);
        const insertResult = await insertExpenseBatch(supabase, {
          batch,
          teamId,
          userId: user.id,
          importRunId,
          startedAt,
        });
        imported += insertResult.imported;
        alreadyImported += insertResult.alreadyImported;
        if (insertResult.error) {
          errors.push(insertResult.error);
        }
      }

      const summary: ExpenseImportSummary = {
        imported: { expenses: imported },
        importedCount: imported,
        skipped: parseResult.skipped.length,
        skippedReasons: parseSkipReasons,
        alreadyImported,
        errors,
        importRunId,
        defaultCategory: DEFAULT_IMPORTED_CATEGORY,
      };

      await supabase
        .from("import_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          summary,
        })
        .eq("id", importRunId);

      revalidatePath("/business");
      revalidatePath("/import");

      return { success: true, summary };
    } catch (err) {
      // Mark the run as failed so the user sees what happened in
      // /import history. Outer catch logs to error_logs.
      await supabase
        .from("import_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          summary: {
            imported,
            alreadyImported,
            errors: [
              ...errors,
              err instanceof Error ? err.message : String(err),
            ],
          },
        })
        .eq("id", importRunId);
      throw err;
    }
  } catch (err) {
    return failure(err, { userId: user.id, teamId });
  }
}

function failure(
  err: unknown,
  context: { userId?: string; teamId?: string },
): { success: false; error: SerializedAppError } {
  const appError = toAppError(err);
  logError(appError, {
    ...context,
    action: "importExpensesCsvAction",
  });
  return { success: false, error: appError.toUserSafe() };
}

interface BatchInsertResult {
  imported: number;
  alreadyImported: number;
  error: string | null;
}

async function insertExpenseBatch(
  supabase: SupabaseClient,
  args: {
    batch: ParsedExpenseRow[];
    teamId: string;
    userId: string;
    importRunId: string;
    startedAt: string;
  },
): Promise<BatchInsertResult> {
  const rows = args.batch.map((r) => ({
    team_id: args.teamId,
    user_id: args.userId,
    incurred_on: r.incurred_on,
    amount: r.amount,
    currency: "USD",
    vendor: r.vendor,
    category: DEFAULT_IMPORTED_CATEGORY,
    description: r.description,
    notes: r.notes,
    billable: false,
    imported_from: EXPENSE_CSV_SOURCE,
    import_source_id: r.import_source_id,
    import_run_id: args.importRunId,
    imported_at: args.startedAt,
  }));

  const { error, count } = await supabase
    .from("expenses")
    .insert(rows, { count: "exact" });

  if (!error) {
    return { imported: count ?? rows.length, alreadyImported: 0, error: null };
  }

  // Partial unique index hit (re-import). The whole batch fails on
  // 23505 — fall back to per-row insert so non-conflict rows still
  // land. With duplicates expected on re-runs and BATCH_SIZE=100,
  // this is the cheapest reliable path; full per-row insert from
  // the start would 100x the round-trip count on a clean import.
  if (error.code === "23505") {
    let imported = 0;
    let alreadyImported = 0;
    let lastError: string | null = null;
    for (const row of rows) {
      const { error: rowErr } = await supabase.from("expenses").insert(row);
      if (!rowErr) {
        imported += 1;
      } else if (rowErr.code === "23505") {
        alreadyImported += 1;
      } else {
        lastError = rowErr.message;
      }
    }
    return { imported, alreadyImported, error: lastError };
  }

  return {
    imported: 0,
    alreadyImported: 0,
    error: `Batch insert failed: ${error.message}`,
  };
}
