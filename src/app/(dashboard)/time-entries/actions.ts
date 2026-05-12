"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { localDateMidnightUtc } from "@/lib/time/tz";
import {
  autoFillDescription,
  buildTicketAttachment,
} from "@/lib/tickets/attach";
import { isInLocalDay } from "@/lib/local-day-bounds";
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
    // billable is decided server-side: internal projects are forced to
    // false (defense in depth — the form hides the toggle, but a
    // forged POST shouldn't slip through). Otherwise: respect the
    // submitted value, OR fall back to the project's default_billable
    // when no `billable` field is present at all (templates / legacy
    // forms).
    const billableSubmitted = formData.has("billable")
      ? formData.get("billable") === "on"
      : null;
    // Legacy github_issue write path is gone — ticket linking now
    // routes through linked_ticket_* via the unified ticket_ref input
    // (or description-based detection). The github_issue COLUMN
    // remains for old data; new entries leave it null.
    const ticketRef = (formData.get("ticket_ref") as string) || null;
    const category_id = (formData.get("category_id") as string) || null;

    if (!project_id) throw new Error("project_id is required");

    // Derive team_id + classification from the project. is_internal
    // and default_billable feed the inheritance logic below.
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("team_id, is_internal, default_billable")
      .eq("id", project_id)
      .single();
    if (projErr || !project) {
      throw new Error("Project not found or not accessible");
    }
    const teamId = project.team_id as string;
    const isInternal = (project as { is_internal?: boolean }).is_internal === true;
    const projectDefaultBillable =
      (project as { default_billable?: boolean }).default_billable !== false;
    const billable = isInternal
      ? false
      : (billableSubmitted ?? projectDefaultBillable);
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

    const ticket = await buildTicketAttachment(
      supabase,
      userId,
      description,
      project_id,
      ticketRef,
    );
    // If the user typed only a ticket key (no description), let the
    // resolved "{key} {title}" become the row's description so the
    // day-view row + week summary don't render as "Untitled".
    const finalDescription = autoFillDescription(description, ticket);

    assertSupabaseOk(
      await supabase.from("time_entries").insert({
        team_id: teamId,
        user_id: userId,
        project_id,
        description: finalDescription,
        start_time,
        end_time,
        billable,
        category_id,
        ...ticket,
      })
    );

    revalidatePath("/time-entries");
    revalidatePath(`/projects/${project_id}`);
  }, "createTimeEntryAction") as unknown as void;
}

export async function updateTimeEntryAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const id = formData.get("id") as string;
    // Same migration as create: ticket linking routes through
    // ticket_ref → linked_ticket_*. The legacy github_issue column
    // is no longer written.
    const ticketRef = (formData.get("ticket_ref") as string) || null;

    const durationMinStr = formData.get("duration_min") as string | null;
    const entryDate = formData.get("entry_date") as string | null;
    const tzOffsetMin = tzOffsetFromForm(formData);

    // Field-selective update: only write what the form actually
    // submitted. Different surfaces send different subsets — the
    // week-view inline edit form only includes description / ticket
    // / billable; the day-view edit form adds time + category. A
    // blanket `update({ ...all_fields })` would coerce missing keys
    // to null and either trip NOT NULL constraints (start_time) or
    // silently blank out fields (category_id) that the user didn't
    // intend to clear.
    const patch: Record<string, unknown> = {};

    if (formData.has("description")) {
      patch.description = (formData.get("description") as string) || null;
    }
    if (formData.has("category_id")) {
      patch.category_id = (formData.get("category_id") as string) || null;
    }

    let timeUpdated = false;
    if (durationMinStr && entryDate) {
      const durationMin = parseInt(durationMinStr, 10);
      const t = entryFromDuration(entryDate, durationMin, tzOffsetMin);
      patch.start_time = t.start_time;
      patch.end_time = t.end_time;
      timeUpdated = true;
    } else if (formData.has("start_time")) {
      patch.start_time = formData.get("start_time") as string;
      patch.end_time = (formData.get("end_time") as string) || null;
      timeUpdated = true;
    }

    // Re-resolve the ticket attachment from the (possibly edited)
    // description when description OR ticket_ref was submitted. The
    // fetch also surfaces the project's classification so we can
    // enforce billable=false on internal projects when billable was
    // submitted.
    const billableSubmitted = formData.has("billable")
      ? formData.get("billable") === "on"
      : null;
    const needsExisting =
      formData.has("billable") ||
      formData.has("description") ||
      formData.has("ticket_ref");
    let projectId: string | null = null;
    let projectIsInternal = false;
    if (needsExisting) {
      const { data: existing } = await supabase
        .from("time_entries")
        .select("project_id, projects(is_internal)")
        .eq("id", id)
        .maybeSingle();
      projectId = (existing?.project_id as string | null) ?? null;
      const p = existing?.projects as
        | { is_internal?: boolean }
        | { is_internal?: boolean }[]
        | null
        | undefined;
      const proj = Array.isArray(p) ? (p[0] ?? null) : (p ?? null);
      projectIsInternal = proj?.is_internal === true;
    }

    if (billableSubmitted !== null) {
      patch.billable = projectIsInternal ? false : billableSubmitted;
    }

    // Ticket attachment is recomputed whenever description or
    // ticket_ref was submitted — the ticket fields live on the
    // entry row and would otherwise grow stale relative to the new
    // description's auto-detect.
    if (formData.has("description") || formData.has("ticket_ref")) {
      const description =
        formData.has("description")
          ? ((formData.get("description") as string) || null)
          : null;
      const ticket = await buildTicketAttachment(
        supabase,
        userId,
        description,
        projectId,
        ticketRef,
      );
      Object.assign(patch, ticket);
      // Symmetric with createTimeEntryAction / startTimerAction:
      // if the user submitted an empty description but a ticket
      // resolved, default the description to "{key} {title}".
      // Only kicks in when description was actually submitted —
      // otherwise we'd overwrite an unrelated existing description
      // just because the user edited the ticket_ref field.
      if (formData.has("description")) {
        const filled = autoFillDescription(description, ticket);
        if (filled !== description) patch.description = filled;
      }
    }

    // Nothing to update — defensively short-circuit so we don't
    // round-trip a no-op `UPDATE ... SET WHERE id = ?` (Postgres
    // is fine with empty SET via PostgREST, but it's a silent no-op
    // that obscures bad form wiring on the client).
    if (Object.keys(patch).length === 0) {
      void timeUpdated;
      return;
    }

    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update(patch)
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
 * Update a single time entry's duration while preserving its
 * start_time. Used by the week-view per-entry sub-row's day cell so
 * the user can adjust "AE-640 was 1:19, actually 1:30" without
 * touching the original start clock or any other field.
 *
 * end_time = start_time + duration_min * 60s, computed at the
 * server so the UI never has to round-trip a fragile timestamp.
 *
 * Refuses (with a friendly userMessage) when the entry is invoiced —
 * the trigger would block the UPDATE anyway, but a pre-check gives
 * a clearer message than the generic CHECK violation.
 */
export async function updateTimeEntryDurationAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (fd, { supabase, userId }) => {
    const id = fd.get("id") as string;
    const durationMinStr = fd.get("duration_min") as string;
    const durationMin = parseInt(durationMinStr, 10);
    if (!id) throw new Error("Entry id required");
    if (!Number.isFinite(durationMin) || durationMin < 0) {
      throw new Error("Duration must be a non-negative number of minutes.");
    }

    // Read existing start_time + invoice state in one trip.
    const { data: existing, error: existingErr } = await supabase
      .from("time_entries")
      .select("user_id, start_time, invoiced, invoice_id")
      .eq("id", id)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) throw new Error("Entry not found");
    if (existing.user_id !== userId) {
      throw new Error("Only the entry's author can edit it.");
    }
    if (existing.invoiced && existing.invoice_id) {
      throw new Error(
        "This entry is on an invoice and is locked. Void the invoice or remove the entry from it before editing.",
      );
    }

    // Zero duration → soft-delete the row. Mirrors the cell-level
    // upsert's "type 0 to delete" semantic so the entire week-grid
    // surface uses the same convention. Recoverable via the trash.
    if (durationMin === 0) {
      assertSupabaseOk(
        await supabase
          .from("time_entries")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", id)
          .eq("user_id", userId),
      );
      revalidatePath("/time-entries");
      revalidatePath("/time-entries/trash");
      return;
    }

    const startMs = new Date(existing.start_time as string).getTime();
    const endIso = new Date(startMs + durationMin * 60_000).toISOString();

    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update({ end_time: endIso })
        .eq("id", id)
        .eq("user_id", userId),
    );

    revalidatePath("/time-entries");
  }, "updateTimeEntryDurationAction") as unknown as void;
}

/**
 * Bulk soft-delete — used by multi-row selection on the day view.
 * RLS + the explicit `.eq("user_id", userId)` clause mean only the
 * caller's own rows will be affected; ids passed in that don't
 * match will be silently no-oped instead of erroring. Pair with an
 * Undo toast that calls `restoreTimeEntriesAction` on the same ids.
 */
export async function deleteTimeEntriesAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const ids = formData.getAll("id").map((v) => String(v));
    if (ids.length === 0) return;

    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update({ deleted_at: new Date().toISOString() })
        .in("id", ids)
        .eq("user_id", userId)
        .is("deleted_at", null),
    );

    revalidatePath("/time-entries");
    revalidatePath("/time-entries/trash");
  }, "deleteTimeEntriesAction") as unknown as void;
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

/**
 * Bulk hard-delete from the trash. Same trash-only guard as the
 * single-row permanent-delete: only rows with deleted_at IS NOT
 * NULL can be hard-deleted, so a stray bulk call on active rows
 * is a no-op rather than a data-loss event. Scoped to the
 * caller's own rows via user_id.
 */
export async function permanentlyDeleteTimeEntriesAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const ids = formData.getAll("id").map((v) => String(v));
    if (ids.length === 0) return;

    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .delete()
        .in("id", ids)
        .eq("user_id", userId)
        .not("deleted_at", "is", null),
    );

    revalidatePath("/time-entries");
    revalidatePath("/time-entries/trash");
  }, "permanentlyDeleteTimeEntriesAction") as unknown as void;
}

export async function startTimerAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const project_id = formData.get("project_id") as string;
    const rawDescription = formData.get("description");
    let description =
      typeof rawDescription === "string" && rawDescription.length > 0
        ? rawDescription
        : null;
    // Optional explicit ticket reference from the new <TicketField>
    // in the New-timer form. When set, takes precedence over
    // description-based detection — and when the description is
    // empty, the resolved "{key} {title}" becomes the description.
    const ticketRefRaw = formData.get("ticket_ref");
    const ticketRef =
      typeof ticketRefRaw === "string" && ticketRefRaw.trim().length > 0
        ? ticketRefRaw.trim()
        : null;
    const category_id = (formData.get("category_id") as string) || null;
    // The header "New timer" form sets `force_new=1` because its intent
    // is "create a fresh entry" — even on (project, category) combos
    // that already have a completed same-day entry. Without this,
    // clicking "New timer" with the same project + category as a
    // morning's work resumed that entry and back-dated start_time, so
    // a user trying to capture a SIBLING entry on a different ticket
    // got their original entry hijacked. The row-Play and timer-chip
    // entry points still want resume behaviour and don't set this.
    const forceNew = formData.get("force_new") === "1";
    // Per-entry resume — when set, the action targets THIS specific
    // entry instead of doing the same-day-same-bucket auto-resume
    // lookup. Used by the per-entry Play button on the week
    // timesheet's sub-rows: "I want THAT entry to be the running
    // timer", not "the most-recently-completed entry on this
    // (project, category) row." Behaviour:
    //   - if the entry is on today's local day → backdate start_time
    //     by its accumulated duration on the same row
    //   - if the entry is on a different day → insert a NEW entry
    //     copying description + category + billable + linked_ticket_*
    //     (timing always lives on today; you can't track time
    //     retroactively via a timer)
    const resumeEntryIdRaw = formData.get("resume_entry_id");
    const resumeEntryId =
      typeof resumeEntryIdRaw === "string" && resumeEntryIdRaw.length > 0
        ? resumeEntryIdRaw
        : null;
    // Viewer's local-day bounds — used to decide whether an existing
    // completed entry on (user, project, category) should be resumed
    // instead of creating a new one. When omitted, falls back to
    // server-local UTC day, which is approximate but safe.
    const dayStartIso = formData.get("day_start_iso") as string | null;
    const dayEndIso = formData.get("day_end_iso") as string | null;

    if (!project_id && !resumeEntryId) {
      throw new Error("project_id is required");
    }

    // Per-entry resume path — invoked from the per-entry Play button
    // on the week timesheet's sub-rows. Targets the specific source
    // entry instead of the same-(project, category, today) lookup.
    if (resumeEntryId) {
      const { data: source, error: srcErr } = await supabase
        .from("time_entries")
        .select(
          "user_id, team_id, project_id, category_id, description, billable, duration_min, start_time, linked_ticket_provider, linked_ticket_key, linked_ticket_url, linked_ticket_title, linked_ticket_refreshed_at, projects(is_internal)",
        )
        .eq("id", resumeEntryId)
        .is("deleted_at", null)
        .maybeSingle();
      if (srcErr || !source) {
        throw new Error("Entry not found or not accessible");
      }
      const sourceTeamId = source.team_id as string;
      const { userId: resumeUserId } = await validateTeamAccess(sourceTeamId);
      // Defense in depth — the same RLS policy enforces this, but
      // a friendly userMessage beats a "permission denied" surface.
      if ((source.user_id as string) !== resumeUserId) {
        throw new Error("Only the entry's author can resume it.");
      }

      const nowDate = new Date();
      const now = nowDate.toISOString();

      // Stop any running timer the user already has before resuming.
      assertSupabaseOk(
        await supabase
          .from("time_entries")
          .update({ end_time: now })
          .eq("user_id", resumeUserId)
          .is("end_time", null)
          .is("deleted_at", null),
      );

      // Compute today's bounds (caller-supplied where possible —
      // their tz is more accurate than the server's UTC day).
      const dayStartLocal =
        dayStartIso ??
        (() => {
          const d = new Date(nowDate);
          d.setUTCHours(0, 0, 0, 0);
          return d.toISOString();
        })();
      const dayEndLocal =
        dayEndIso ??
        (() => {
          const d = new Date(nowDate);
          d.setUTCHours(0, 0, 0, 0);
          d.setUTCDate(d.getUTCDate() + 1);
          return d.toISOString();
        })();
      const isOnToday = isInLocalDay(
        source.start_time as string,
        dayStartLocal,
        dayEndLocal,
      );

      if (isOnToday) {
        // Resume in place — backdate start_time so the running
        // timer ticks forward from where it left off, and clear
        // end_time so the row is "running" again.
        const accumulatedMin = (source.duration_min as number | null) ?? 0;
        const backdated = new Date(
          nowDate.getTime() - accumulatedMin * 60_000,
        ).toISOString();
        assertSupabaseOk(
          await supabase
            .from("time_entries")
            .update({ start_time: backdated, end_time: null })
            .eq("id", resumeEntryId)
            .eq("user_id", resumeUserId),
        );
      } else {
        // Source entry is on a different day — timing always lives
        // on today, so insert a NEW entry copying the source's
        // identifying fields (project, category, description, ticket
        // attachment, billable subject to internal-project pin).
        const sourceProject = source.projects as
          | { is_internal?: boolean }
          | { is_internal?: boolean }[]
          | null;
        const sourceProjArr = Array.isArray(sourceProject)
          ? sourceProject[0] ?? null
          : sourceProject;
        const sourceProjectIsInternal = sourceProjArr?.is_internal === true;
        assertSupabaseOk(
          await supabase.from("time_entries").insert({
            team_id: sourceTeamId,
            user_id: resumeUserId,
            project_id: source.project_id,
            category_id: source.category_id,
            description: source.description,
            billable: sourceProjectIsInternal
              ? false
              : (source.billable as boolean),
            start_time: now,
            end_time: null,
            linked_ticket_provider: source.linked_ticket_provider,
            linked_ticket_key: source.linked_ticket_key,
            linked_ticket_url: source.linked_ticket_url,
            linked_ticket_title: source.linked_ticket_title,
            linked_ticket_refreshed_at: source.linked_ticket_refreshed_at,
          }),
        );
      }

      revalidatePath("/time-entries");
      return;
    }

    // Derive team_id from the project — NEVER trust the form's team_id
    // field. When a user clicks a "recent project" chip the Team dropdown
    // doesn't re-sync; inserting with mismatched team_id trips the RLS
    // policy `project.team_id = time_entries.team_id` and the user sees
    // a generic "permission denied" error. Same fetch surfaces the
    // project's classification (is_internal + default_billable) so
    // the new entry inherits the correct billable value.
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("team_id, is_internal, default_billable")
      .eq("id", project_id)
      .single();
    if (projErr || !project) {
      throw new Error("Project not found or not accessible");
    }
    const teamId = project.team_id as string;
    const projectIsInternal =
      (project as { is_internal?: boolean }).is_internal === true;
    const projectDefaultBillable =
      (project as { default_billable?: boolean }).default_billable !== false;

    // Still validate the caller has access to that team — defense in
    // depth. RLS would block it too, but we want a clean userMessage.
    const { userId } = await validateTeamAccess(teamId);

    const nowDate = new Date();
    const now = nowDate.toISOString();

    // Stop any running timer the user already has before starting a new
    // one. The running-timer card enforces stop-before-start in its own
    // UI, but other entry points (week-row Play, day-row kebab "Start
    // timer") don't — so we enforce it here, centrally.
    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update({ end_time: now })
        .eq("user_id", userId)
        .is("end_time", null)
        .is("deleted_at", null),
    );

    // Look for a completed entry today on the same (user, project,
    // category). If one exists, RESUME it — backdate start_time so
    // the generated `duration_min` picks up where it left off on the
    // next stop, instead of spawning a fresh row. Keeps the day view
    // clean (one row per project/category/day) and preserves the
    // entry's accumulated duration automatically.
    const dayStart =
      dayStartIso ??
      (() => {
        const d = new Date(nowDate);
        d.setUTCHours(0, 0, 0, 0);
        return d.toISOString();
      })();
    const dayEnd =
      dayEndIso ??
      (() => {
        const d = new Date(nowDate);
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString();
      })();

    // Resume-same-day-entry lookup. Skipped entirely when `force_new`
    // is set: the header New-timer button explicitly wants a fresh
    // entry even when a same-day same-(project, category) entry
    // exists.
    let existing: { id: string; duration_min: number | null; description: string | null } | undefined;
    if (!forceNew) {
      let existingQuery = supabase
        .from("time_entries")
        .select("id, duration_min, description")
        .eq("user_id", userId)
        .eq("project_id", project_id)
        .not("end_time", "is", null)
        .is("deleted_at", null)
        .gte("start_time", dayStart)
        .lt("start_time", dayEnd)
        .order("start_time", { ascending: false })
        .limit(1);
      if (category_id) existingQuery = existingQuery.eq("category_id", category_id);
      else existingQuery = existingQuery.is("category_id", null);
      const { data: existingRows } = await existingQuery;
      existing = existingRows?.[0] as
        | { id: string; duration_min: number | null; description: string | null }
        | undefined;
    }

    // When the caller supplied a description OR an explicit ticket
    // reference, run ticket detection + lookup so the running timer's
    // chip shows up immediately. For the resume-existing-entry path
    // we only re-run detection when one of those fields was supplied
    // — otherwise the existing attachment stays.
    const ticket =
      description !== null || ticketRef !== null
        ? await buildTicketAttachment(
            supabase,
            userId,
            description,
            project_id,
            ticketRef,
          )
        : null;

    description = autoFillDescription(description, ticket);

    if (existing) {
      const accumulatedMin = (existing.duration_min as number | null) ?? 0;
      const backdatedStart = new Date(
        nowDate.getTime() - accumulatedMin * 60_000,
      ).toISOString();
      // Only overwrite description when the caller supplied one. A
      // week-row Play click (no description) should leave the existing
      // entry's note intact.
      const updatePayload: Record<string, unknown> = {
        start_time: backdatedStart,
        end_time: null,
      };
      if (description !== null) {
        updatePayload.description = description;
        if (ticket) Object.assign(updatePayload, ticket);
      }
      assertSupabaseOk(
        await supabase
          .from("time_entries")
          .update(updatePayload)
          .eq("id", existing.id)
          .eq("user_id", userId),
      );
    } else {
      assertSupabaseOk(
        await supabase.from("time_entries").insert({
          team_id: teamId,
          user_id: userId,
          project_id,
          description,
          start_time: now,
          end_time: null,
          // Inherit project classification: internal projects pin to
          // false; otherwise honor the project's default_billable.
          billable: projectIsInternal ? false : projectDefaultBillable,
          category_id,
          ...(ticket ?? {}),
        }),
      );
    }

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
 * project/description/billable + linked_ticket_*. Stops any running
 * timer first. Legacy github_issue (integer) carries through untouched
 * for old data — new entries no longer write that column.
 */
export async function duplicateTimeEntryAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const sourceId = formData.get("id") as string;

    // Fetch source entry — include ticket-link fields so the
    // duplicate carries the same chip without a re-lookup round
    // trip. The source's data is already authoritative for "what
    // ticket is this work about."
    const { data: source, error: fetchErr } = await supabase
      .from("time_entries")
      .select(
        "team_id, project_id, description, billable, github_issue, category_id, linked_ticket_provider, linked_ticket_key, linked_ticket_url, linked_ticket_title, linked_ticket_refreshed_at",
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

    // Re-read the project's classification at duplicate time. If the
    // source's project flipped to internal between the original entry
    // and now, the duplicate must inherit the new policy
    // (billable=false), not the source's stale value.
    const { data: dupProject } = await supabase
      .from("projects")
      .select("is_internal")
      .eq("id", source.project_id as string)
      .maybeSingle();
    const dupBillable =
      (dupProject as { is_internal?: boolean } | null)?.is_internal === true
        ? false
        : (source.billable as boolean);

    // Insert the duplicate as a running timer
    assertSupabaseOk(
      await supabase.from("time_entries").insert({
        team_id: source.team_id,
        user_id: userId,
        project_id: source.project_id,
        description: source.description,
        start_time: now,
        end_time: null,
        billable: dupBillable,
        github_issue: source.github_issue,
        category_id: source.category_id,
        linked_ticket_provider: source.linked_ticket_provider,
        linked_ticket_key: source.linked_ticket_key,
        linked_ticket_url: source.linked_ticket_url,
        linked_ticket_title: source.linked_ticket_title,
        linked_ticket_refreshed_at: source.linked_ticket_refreshed_at,
      })
    );

    revalidatePath("/time-entries");
  }, "duplicateTimeEntryAction") as unknown as void;
}

/**
 * Re-fetch the linked ticket's title from its source system and
 * update the entry. Owner of the entry only — invoked from the
 * chip's refresh button when the user notices the Jira/GitHub
 * title has drifted.
 */
export async function refreshTicketTitleAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const id = String(fd.get("id") ?? "");
      if (!id) throw new Error("Entry id required");

      const { data: row } = await supabase
        .from("time_entries")
        .select(
          "user_id, project_id, linked_ticket_provider, linked_ticket_key",
        )
        .eq("id", id)
        .maybeSingle();
      if (!row) throw new Error("Entry not found");
      if (row.user_id !== userId) {
        throw new Error("Only the entry's author can refresh its ticket.");
      }
      const provider = row.linked_ticket_provider as
        | "jira"
        | "github"
        | null;
      const key = row.linked_ticket_key as string | null;
      if (!provider || !key) {
        throw new Error("Entry has no linked ticket to refresh.");
      }

      // Reuse buildTicketAttachment by passing the existing key as
      // the description — it'll detect, look up, and return the
      // refreshed columns. Fall back to noop when lookup fails.
      const attachment = await buildTicketAttachment(
        supabase,
        userId,
        key,
        (row.project_id as string | null) ?? null,
      );

      // If detection didn't find anything (shouldn't happen — the
      // key itself satisfies the regex), bail.
      if (!attachment.linked_ticket_provider) return;

      assertSupabaseOk(
        await supabase
          .from("time_entries")
          .update(attachment)
          .eq("id", id)
          .eq("user_id", userId),
      );

      revalidatePath("/time-entries");
    },
    "refreshTicketTitleAction",
  ) as unknown as void;
}

/**
 * Replace a time entry's description with the linked ticket's
 * resolved title. Useful after a refresh has populated
 * linked_ticket_title — the user can one-click sync the description
 * to the source-of-truth title without retyping.
 *
 * If the title hasn't been fetched yet, falls back to attempting a
 * refresh first so the action is one-click from a "key only" state.
 *
 * Owner-of-entry only — same gate as refreshTicketTitleAction.
 */
export async function applyTicketTitleAsDescriptionAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const id = String(fd.get("id") ?? "");
      if (!id) throw new Error("Entry id required");

      const { data: row } = await supabase
        .from("time_entries")
        .select(
          "user_id, project_id, linked_ticket_provider, linked_ticket_key, linked_ticket_title",
        )
        .eq("id", id)
        .maybeSingle();
      if (!row) throw new Error("Entry not found");
      if (row.user_id !== userId) {
        throw new Error("Only the entry's author can sync its description.");
      }
      const provider = row.linked_ticket_provider as
        | "jira"
        | "github"
        | null;
      const key = row.linked_ticket_key as string | null;
      if (!provider || !key) {
        throw new Error("Entry has no linked ticket.");
      }

      // Use the existing cached title when present; otherwise refresh
      // it through the same path the chip's refresh button uses so
      // this action works one-click from a "key only" state.
      let title = row.linked_ticket_title as string | null;
      if (!title) {
        const attachment = await buildTicketAttachment(
          supabase,
          userId,
          key,
          (row.project_id as string | null) ?? null,
        );
        title = attachment.linked_ticket_title;
        // Persist the refreshed columns alongside the description
        // change in a single update.
        if (title) {
          assertSupabaseOk(
            await supabase
              .from("time_entries")
              .update({
                ...attachment,
                description: `${key} ${title}`,
              })
              .eq("id", id)
              .eq("user_id", userId),
          );
          revalidatePath("/time-entries");
          return;
        }
        throw new Error("Could not resolve ticket title.");
      }

      // Prefix the description with the ticket key so the reference
      // round-trips through detection on subsequent saves and reads
      // naturally on reports / invoices ("AE-640 Fix login bug").
      assertSupabaseOk(
        await supabase
          .from("time_entries")
          .update({ description: `${key} ${title}` })
          .eq("id", id)
          .eq("user_id", userId),
      );

      revalidatePath("/time-entries");
    },
    "applyTicketTitleAsDescriptionAction",
  ) as unknown as void;
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
      .select(
        "id, description, billable, github_issue, duration_min, invoiced, invoice_id",
      )
      .eq("project_id", project_id)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .gte("start_time", dayStart.toISOString())
      .lt("start_time", dayEnd.toISOString());
    if (category_id) q = q.eq("category_id", category_id);
    else q = q.is("category_id", null);
    const { data: existing, error: existingErr } = await q;
    if (existingErr) throw existingErr;

    // Refuse early when any entry in the cell is invoiced. The DB
    // trigger added in 20260501040000 would also block this, but
    // its error message is generic and the cell-level edit path
    // can give a clearer one ("this cell has an invoiced entry").
    // Without an explicit refusal here the runSafeAction wrapper
    // would surface the trigger's CHECK_VIOLATION as a string the
    // user has to parse — clearer to bail early.
    const lockedEntry = (existing ?? []).find(
      (e) => e.invoiced === true && e.invoice_id !== null,
    );
    if (lockedEntry) {
      throw new Error(
        "This cell has an invoiced entry and is locked. Void the invoice first, or remove the entry from it.",
      );
    }

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
      // Insert new — inherit project's billable policy. Internal
      // projects pin to false; external projects use the project's
      // default_billable. The timesheet cell has no per-cell billable
      // override (it's a duration-only quick-entry surface).
      const { data: projectClass } = await supabase
        .from("projects")
        .select("is_internal, default_billable")
        .eq("id", project_id)
        .maybeSingle();
      const cellInternal =
        (projectClass as { is_internal?: boolean } | null)?.is_internal === true;
      const cellDefault =
        (projectClass as { default_billable?: boolean } | null)
          ?.default_billable !== false;
      assertSupabaseOk(
        await supabase.from("time_entries").insert({
          team_id: teamId,
          user_id: userId,
          project_id,
          category_id,
          description: null,
          start_time: t.start_time,
          end_time: t.end_time,
          billable: cellInternal ? false : cellDefault,
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
