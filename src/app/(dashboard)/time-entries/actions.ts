"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateOrgAccess } from "@/lib/org-context";
import { revalidatePath } from "next/cache";

export async function createTimeEntryAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const orgId = formData.get("organization_id") as string;
    const { userId } = await validateOrgAccess(orgId);

    const project_id = formData.get("project_id") as string;
    const description = (formData.get("description") as string) || null;
    const start_time = formData.get("start_time") as string;
    const end_time = (formData.get("end_time") as string) || null;
    const billable = formData.get("billable") === "on";
    const issueStr = formData.get("github_issue") as string;
    const github_issue = issueStr ? parseInt(issueStr, 10) : null;

    assertSupabaseOk(
      await supabase.from("time_entries").insert({
        organization_id: orgId,
        user_id: userId,
        project_id,
        description,
        start_time,
        end_time: end_time || null,
        billable,
        github_issue,
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
    const start_time = formData.get("start_time") as string;
    const end_time = (formData.get("end_time") as string) || null;
    const billable = formData.get("billable") === "on";
    const issueStr = formData.get("github_issue") as string;
    const github_issue = issueStr ? parseInt(issueStr, 10) : null;

    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update({
          description,
          start_time,
          end_time: end_time || null,
          billable,
          github_issue,
        })
        .eq("id", id)
        .eq("user_id", userId)
    );

    revalidatePath("/time-entries");
  }, "updateTimeEntryAction") as unknown as void;
}

export async function deleteTimeEntryAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const id = formData.get("id") as string;

    assertSupabaseOk(
      await supabase.from("time_entries").delete().eq("id", id).eq("user_id", userId)
    );

    revalidatePath("/time-entries");
  }, "deleteTimeEntryAction") as unknown as void;
}

export async function startTimerAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const orgId = formData.get("organization_id") as string;
    const { userId } = await validateOrgAccess(orgId);

    const project_id = formData.get("project_id") as string;
    const description = (formData.get("description") as string) || null;

    assertSupabaseOk(
      await supabase.from("time_entries").insert({
        organization_id: orgId,
        user_id: userId,
        project_id,
        description,
        start_time: new Date().toISOString(),
        end_time: null,
        billable: true,
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
      .select("organization_id, project_id, description, billable, github_issue")
      .eq("id", sourceId)
      .eq("user_id", userId)
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
    );

    // Insert the duplicate as a running timer
    assertSupabaseOk(
      await supabase.from("time_entries").insert({
        organization_id: source.organization_id,
        user_id: userId,
        project_id: source.project_id,
        description: source.description,
        start_time: now,
        end_time: null,
        billable: source.billable,
        github_issue: source.github_issue,
      })
    );

    revalidatePath("/time-entries");
  }, "duplicateTimeEntryAction") as unknown as void;
}
