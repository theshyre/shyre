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
  return runSafeAction(formData, async (formData, { supabase }) => {
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
    );

    revalidatePath("/time-entries");
    revalidatePath(`/time-entries/${id}`);
  }, "updateTimeEntryAction") as unknown as void;
}

export async function deleteTimeEntryAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;

    assertSupabaseOk(
      await supabase.from("time_entries").delete().eq("id", id)
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
    revalidatePath("/timer");
  }, "startTimerAction") as unknown as void;
}

export async function stopTimerAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;

    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update({ end_time: new Date().toISOString() })
        .eq("id", id)
    );

    revalidatePath("/time-entries");
    revalidatePath("/timer");
  }, "stopTimerAction") as unknown as void;
}
