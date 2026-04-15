"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { localDateMidnightUtc } from "@/lib/time/tz";
import { revalidatePath } from "next/cache";

/**
 * Given an entry_date (YYYY-MM-DD in the user's local TZ) and duration in
 * minutes, return a (start_time, end_time) pair anchored at that local
 * midnight, converted to UTC using the caller's tz offset.
 */
function entryFromDuration(
  entryDate: string,
  durationMin: number,
  tzOffsetMin: number,
): { start_time: string; end_time: string } {
  const start = localDateMidnightUtc(entryDate, tzOffsetMin);
  const end = new Date(start.getTime() + durationMin * 60 * 1000);
  return {
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  };
}

function tzOffsetFromForm(formData: FormData): number {
  const raw = formData.get("tz_offset_min");
  if (typeof raw !== "string") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < -840 || n > 840) return 0;
  return n;
}

export async function createTimeEntryAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const project_id = formData.get("project_id") as string;
    const description = (formData.get("description") as string) || null;
    const billable = formData.get("billable") === "on";
    const issueStr = formData.get("github_issue") as string;
    const github_issue = issueStr ? parseInt(issueStr, 10) : null;
    const category_id = (formData.get("category_id") as string) || null;

    if (!project_id) throw new Error("project_id is required");

    // Derive team_id from the project — see startTimerAction for rationale.
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("team_id")
      .eq("id", project_id)
      .single();
    if (projErr || !project) {
      throw new Error("Project not found or not accessible");
    }
    const teamId = project.team_id as string;
    const { userId } = await validateTeamAccess(teamId);

    // Duration-only mode: form submits `entry_date` (YYYY-MM-DD) + `duration_min`
    // Timestamp mode: form submits `start_time` + optional `end_time`
    const durationMinStr = formData.get("duration_min") as string | null;
    const entryDate = formData.get("entry_date") as string | null;
    const tzOffsetMin = tzOffsetFromForm(formData);

    let start_time: string;
    let end_time: string | null;
    if (durationMinStr && entryDate) {
      const durationMin = parseInt(durationMinStr, 10);
      const t = entryFromDuration(entryDate, durationMin, tzOffsetMin);
      start_time = t.start_time;
      end_time = t.end_time;
    } else {
      start_time = formData.get("start_time") as string;
      end_time = (formData.get("end_time") as string) || null;
    }

    assertSupabaseOk(
      await supabase.from("time_entries").insert({
        team_id: teamId,
        user_id: userId,
        project_id,
        description,
        start_time,
        end_time,
        billable,
        github_issue,
        category_id,
      })
    );

    revalidatePath("/time-entries");
    revalidatePath(`/projects/${project_id}`);
  }, "createTimeEntryAction") as unknown as void;
}

export async function updateTimeEntryAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const id = formData.get("id") as string;
    const description = (formData.get("description") as string) || null;
    const billable = formData.get("billable") === "on";
    const issueStr = formData.get("github_issue") as string;
    const github_issue = issueStr ? parseInt(issueStr, 10) : null;
    const category_id = (formData.get("category_id") as string) || null;

    const durationMinStr = formData.get("duration_min") as string | null;
    const entryDate = formData.get("entry_date") as string | null;
    const tzOffsetMin = tzOffsetFromForm(formData);

    let start_time: string | undefined;
    let end_time: string | null | undefined;
    if (durationMinStr && entryDate) {
      const durationMin = parseInt(durationMinStr, 10);
      const t = entryFromDuration(entryDate, durationMin, tzOffsetMin);
      start_time = t.start_time;
      end_time = t.end_time;
    } else {
      start_time = formData.get("start_time") as string;
      end_time = (formData.get("end_time") as string) || null;
    }

    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update({
          description,
          start_time,
          end_time,
          billable,
          github_issue,
          category_id,
        })
        .eq("id", id)
        .eq("user_id", userId)
    );

    revalidatePath("/time-entries");
  }, "updateTimeEntryAction") as unknown as void;
}

/**
 * Soft-delete a time entry. Sets deleted_at = now() so the entry is hidden
 * from normal listings but recoverable via restoreTimeEntryAction or the
 * /time-entries/trash page. Use permanentlyDeleteTimeEntryAction to wipe.
 */
export async function deleteTimeEntryAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const id = formData.get("id") as string;

    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId)
        .is("deleted_at", null)
    );

    revalidatePath("/time-entries");
    revalidatePath("/time-entries/trash");
  }, "deleteTimeEntryAction") as unknown as void;
}

/**
 * Restore a soft-deleted entry (clear deleted_at). Only affects entries
 * owned by the caller — RLS enforces user_id match.
 */
export async function restoreTimeEntryAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const id = formData.get("id") as string;

    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update({ deleted_at: null })
        .eq("id", id)
        .eq("user_id", userId)
        .not("deleted_at", "is", null)
    );

    revalidatePath("/time-entries");
    revalidatePath("/time-entries/trash");
  }, "restoreTimeEntryAction") as unknown as void;
}

/**
 * Hard delete a soft-deleted entry from the trash. Only trashed rows
 * (deleted_at IS NOT NULL) can be permanently deleted — a safety guard
 * against accidentally wiping an active entry.
 */
export async function permanentlyDeleteTimeEntryAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const id = formData.get("id") as string;

    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .not("deleted_at", "is", null)
    );

    revalidatePath("/time-entries");
    revalidatePath("/time-entries/trash");
  }, "permanentlyDeleteTimeEntryAction") as unknown as void;
}

/**
 * Bulk restore — used by the Undo toast when an entire timesheet row
 * (multiple day cells) was soft-deleted in one action.
 */
export async function restoreTimeEntriesAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const ids = formData.getAll("id").map((v) => String(v));
    if (ids.length === 0) return;

    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update({ deleted_at: null })
        .in("id", ids)
        .eq("user_id", userId)
        .not("deleted_at", "is", null)
    );

    revalidatePath("/time-entries");
    revalidatePath("/time-entries/trash");
  }, "restoreTimeEntriesAction") as unknown as void;
}

export async function startTimerAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const project_id = formData.get("project_id") as string;
    const description = (formData.get("description") as string) || null;
    const category_id = (formData.get("category_id") as string) || null;

    if (!project_id) throw new Error("project_id is required");

    // Derive team_id from the project — NEVER trust the form's team_id
    // field. When a user clicks a "recent project" chip the Team dropdown
    // doesn't re-sync; inserting with mismatched team_id trips the RLS
    // policy `project.team_id = time_entries.team_id` and the user sees
    // a generic "permission denied" error.
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("team_id")
      .eq("id", project_id)
      .single();
    if (projErr || !project) {
      throw new Error("Project not found or not accessible");
    }
    const teamId = project.team_id as string;

    // Still validate the caller has access to that team — defense in
    // depth. RLS would block it too, but we want a clean userMessage.
    const { userId } = await validateTeamAccess(teamId);

    assertSupabaseOk(
      await supabase.from("time_entries").insert({
        team_id: teamId,
        user_id: userId,
        project_id,
        description,
        start_time: new Date().toISOString(),
        end_time: null,
        billable: true,
        category_id,
      })
    );

    revalidatePath("/time-entries");
  }, "startTimerAction") as unknown as void;
}

export async function stopTimerAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const id = formData.get("id") as string;

    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update({ end_time: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId)
    );

    revalidatePath("/time-entries");
  }, "stopTimerAction") as unknown as void;
}

/**
 * Duplicate a time entry: start a new timer now with the same
 * project/description/billable/github_issue. Stops any running timer first.
 */
export async function duplicateTimeEntryAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const sourceId = formData.get("id") as string;

    // Fetch source entry
    const { data: source, error: fetchErr } = await supabase
      .from("time_entries")
      .select(
        "team_id, project_id, description, billable, github_issue, category_id",
      )
      .eq("id", sourceId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .single();
    if (fetchErr) throw fetchErr;
    if (!source) throw new Error("Entry not found");

    const now = new Date().toISOString();

    // Stop any running timer for this user
    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update({ end_time: now })
        .eq("user_id", userId)
        .is("end_time", null)
        .is("deleted_at", null)
    );

    // Insert the duplicate as a running timer
    assertSupabaseOk(
      await supabase.from("time_entries").insert({
        team_id: source.team_id,
        user_id: userId,
        project_id: source.project_id,
        description: source.description,
        start_time: now,
        end_time: null,
        billable: source.billable,
        github_issue: source.github_issue,
        category_id: source.category_id,
      })
    );

    revalidatePath("/time-entries");
  }, "duplicateTimeEntryAction") as unknown as void;
}

/**
 * Upsert the total duration for a (project, category, date) cell in the
 * weekly timesheet. If durationMin is 0, deletes all entries for that cell.
 * Otherwise, either:
 *  - updates the single existing entry for that cell, OR
 *  - inserts a new entry (when none exist)
 * If multiple entries exist for that cell (unusual — manual timer sessions),
 * their total is squashed into one entry with a preserved description.
 */
export async function upsertTimesheetCellAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const project_id = formData.get("project_id") as string;
    const category_id = (formData.get("category_id") as string) || null;
    const entry_date = formData.get("entry_date") as string;
    const teamId = formData.get("team_id") as string;
    const durationMinStr = formData.get("duration_min") as string;
    const durationMin = parseInt(durationMinStr, 10);
    const tzOffsetMin = tzOffsetFromForm(formData);
    await validateTeamAccess(teamId);

    const dayStart = localDateMidnightUtc(entry_date, tzOffsetMin);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // Find existing (non-deleted) entries in this (project, category, day) cell
    let q = supabase
      .from("time_entries")
      .select("id, description, billable, github_issue, duration_min")
      .eq("project_id", project_id)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .gte("start_time", dayStart.toISOString())
      .lt("start_time", dayEnd.toISOString());
    if (category_id) q = q.eq("category_id", category_id);
    else q = q.is("category_id", null);
    const { data: existing, error: existingErr } = await q;
    if (existingErr) throw existingErr;

    // Zero duration → soft-delete everything in the cell so it can be
    // recovered via the trash. Matches row-level delete semantics.
    if (!durationMinStr || durationMin <= 0) {
      if (existing && existing.length > 0) {
        assertSupabaseOk(
          await supabase
            .from("time_entries")
            .update({ deleted_at: new Date().toISOString() })
            .in(
              "id",
              existing.map((e) => e.id),
            ),
        );
      }
      revalidatePath("/time-entries");
      revalidatePath("/time-entries/trash");
      return;
    }

    const t = entryFromDuration(entry_date, durationMin, tzOffsetMin);

    if (!existing || existing.length === 0) {
      // Insert new
      assertSupabaseOk(
        await supabase.from("time_entries").insert({
          team_id: teamId,
          user_id: userId,
          project_id,
          category_id,
          description: null,
          start_time: t.start_time,
          end_time: t.end_time,
          billable: true,
        }),
      );
    } else if (existing.length === 1) {
      // Update the single existing row
      assertSupabaseOk(
        await supabase
          .from("time_entries")
          .update({
            start_time: t.start_time,
            end_time: t.end_time,
          })
          .eq("id", existing[0]!.id)
          .eq("user_id", userId),
      );
    } else {
      // Multiple rows → keep first, delete rest, then set total on the first
      const [keep, ...drop] = existing;
      assertSupabaseOk(
        await supabase
          .from("time_entries")
          .delete()
          .in(
            "id",
            drop.map((e) => e.id),
          ),
      );
      assertSupabaseOk(
        await supabase
          .from("time_entries")
          .update({
            start_time: t.start_time,
            end_time: t.end_time,
          })
          .eq("id", keep!.id)
          .eq("user_id", userId),
      );
    }

    revalidatePath("/time-entries");
  }, "upsertTimesheetCellAction") as unknown as void;
}
