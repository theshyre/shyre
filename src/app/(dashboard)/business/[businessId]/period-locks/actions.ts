"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";

function blankToNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Lock the books for a team through `period_end` (inclusive).
 * Owner|admin only. The DB-level RLS policy enforces the same gate;
 * this is the friendly-error layer.
 *
 * Effect: any future write to time_entries / expenses / invoices
 * targeting a date on or before `period_end` raises a check-violation.
 */
export async function lockPeriodAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase }) => {
      const teamId = String(fd.get("team_id") ?? "");
      const periodEnd = blankToNull(fd.get("period_end"));
      const notes = blankToNull(fd.get("notes"));

      if (!teamId) throw new Error("Team is required.");
      if (!periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
        throw new Error("Period end must be YYYY-MM-DD.");
      }
      const { role } = await validateTeamAccess(teamId);
      if (role !== "owner" && role !== "admin") {
        throw new Error("Only owners and admins can lock periods.");
      }

      assertSupabaseOk(
        await supabase
          .from("team_period_locks")
          .insert({ team_id: teamId, period_end: periodEnd, notes }),
      );

      revalidatePath("/business");
    },
    "lockPeriodAction",
  );
}

/**
 * Unlock a previously-set period. Owner|admin only. The action
 * requires the user to type the literal word "unlock" in the
 * `confirm` field — destructive-confirmation pattern matching the
 * void-invoice flow.
 */
export async function unlockPeriodAction(formData: FormData): Promise<
  | { success: true }
  | { success: false; error: import("@/lib/errors").SerializedAppError }
> {
  return runSafeAction(
    formData,
    async (fd, { supabase }) => {
      const teamId = String(fd.get("team_id") ?? "");
      const periodEnd = blankToNull(fd.get("period_end"));
      const confirm = blankToNull(fd.get("confirm"));

      if (!teamId) throw new Error("Team is required.");
      if (!periodEnd) throw new Error("Period end is required.");
      if ((confirm ?? "").toLowerCase() !== "unlock") {
        throw new Error("Type 'unlock' to confirm.");
      }
      const { role } = await validateTeamAccess(teamId);
      if (role !== "owner" && role !== "admin") {
        throw new Error("Only owners and admins can unlock periods.");
      }

      assertSupabaseOk(
        await supabase
          .from("team_period_locks")
          .delete()
          .eq("team_id", teamId)
          .eq("period_end", periodEnd),
      );

      revalidatePath("/business");
    },
    "unlockPeriodAction",
  );
}
