"use server";

import { createClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors";
import { requireSystemAdmin } from "@/lib/system-admin";
import { revalidatePath } from "next/cache";

/** Severities the resolve-all action accepts as a scope. */
const RESOLVABLE_SEVERITIES = new Set(["error", "warning", "info"]);

/**
 * Resolve every unresolved occurrence in a duplicate-group (a group of
 * 1 is the single-error case). `error_ids` is a comma-separated id
 * list; the `.is("resolved_at", null)` guard keeps already-resolved
 * rows' original resolver + timestamp intact.
 */
export async function resolveErrorGroupAction(
  formData: FormData,
): Promise<void> {
  const { userId } = await requireSystemAdmin();
  const supabase = await createClient();

  const raw = formData.get("error_ids");
  const ids =
    typeof raw === "string"
      ? raw
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      : [];
  if (ids.length === 0) {
    throw AppError.validation("error_ids is required");
  }

  const { error } = await supabase
    .from("error_logs")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .in("id", ids)
    .is("resolved_at", null);

  if (error) throw AppError.fromSupabase(error);
  revalidatePath("/system/errors");
}

/**
 * Resolve ALL unresolved errors matching the page's active filter.
 * `severity` scopes the sweep ("error" / "warning" / "info"); empty or
 * "all" resolves every unresolved row. Anything else is rejected —
 * a typo must not silently widen the sweep to everything.
 */
export async function resolveAllErrorsAction(
  formData: FormData,
): Promise<void> {
  const { userId } = await requireSystemAdmin();
  const supabase = await createClient();

  const raw = formData.get("severity");
  const severityInput = typeof raw === "string" ? raw : "";
  if (
    severityInput !== "" &&
    severityInput !== "all" &&
    !RESOLVABLE_SEVERITIES.has(severityInput)
  ) {
    throw AppError.validation(`Unknown severity scope: ${severityInput}`);
  }
  const severity = RESOLVABLE_SEVERITIES.has(severityInput)
    ? severityInput
    : null;

  let query = supabase
    .from("error_logs")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .is("resolved_at", null);

  if (severity) {
    query = query.eq("severity", severity);
  }

  const { error } = await query;

  if (error) throw AppError.fromSupabase(error);
  revalidatePath("/system/errors");
}
