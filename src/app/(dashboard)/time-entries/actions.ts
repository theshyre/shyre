"use server";

import { safeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateOrgAccess } from "@/lib/org-context";
import { revalidatePath } from "next/cache";

export const createTimeEntryAction = safeAction(async (formData, { supabase }) => {
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
}, "createTimeEntryAction");

export const updateTimeEntryAction = safeAction(async (formData, { supabase }) => {
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
}, "updateTimeEntryAction");

export const deleteTimeEntryAction = safeAction(async (formData, { supabase }) => {
  const id = formData.get("id") as string;

  assertSupabaseOk(
    await supabase.from("time_entries").delete().eq("id", id)
  );

  revalidatePath("/time-entries");
}, "deleteTimeEntryAction");

export const startTimerAction = safeAction(async (formData, { supabase }) => {
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
}, "startTimerAction");

export const stopTimerAction = safeAction(async (formData, { supabase }) => {
  const id = formData.get("id") as string;

  assertSupabaseOk(
    await supabase
      .from("time_entries")
      .update({ end_time: new Date().toISOString() })
      .eq("id", id)
  );

  revalidatePath("/time-entries");
  revalidatePath("/timer");
}, "stopTimerAction");
