"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createTimeEntryAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const project_id = formData.get("project_id") as string;
  const description = (formData.get("description") as string) || null;
  const start_time = formData.get("start_time") as string;
  const end_time = (formData.get("end_time") as string) || null;
  const billable = formData.get("billable") === "on";
  const issueStr = formData.get("github_issue") as string;
  const github_issue = issueStr ? parseInt(issueStr, 10) : null;

  const { error } = await supabase.from("time_entries").insert({
    user_id: user.id,
    project_id,
    description,
    start_time,
    end_time: end_time || null,
    billable,
    github_issue,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/time-entries");
  revalidatePath(`/projects/${project_id}`);
}

export async function updateTimeEntryAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = formData.get("id") as string;
  const description = (formData.get("description") as string) || null;
  const start_time = formData.get("start_time") as string;
  const end_time = (formData.get("end_time") as string) || null;
  const billable = formData.get("billable") === "on";
  const issueStr = formData.get("github_issue") as string;
  const github_issue = issueStr ? parseInt(issueStr, 10) : null;

  const { error } = await supabase
    .from("time_entries")
    .update({
      description,
      start_time,
      end_time: end_time || null,
      billable,
      github_issue,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/time-entries");
  revalidatePath(`/time-entries/${id}`);
}

export async function deleteTimeEntryAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const id = formData.get("id") as string;

  const { error } = await supabase.from("time_entries").delete().eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/time-entries");
}

export async function startTimerAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const project_id = formData.get("project_id") as string;
  const description = (formData.get("description") as string) || null;

  const { error } = await supabase.from("time_entries").insert({
    user_id: user.id,
    project_id,
    description,
    start_time: new Date().toISOString(),
    end_time: null,
    billable: true,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/time-entries");
  revalidatePath("/timer");
}

export async function stopTimerAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const id = formData.get("id") as string;

  const { error } = await supabase
    .from("time_entries")
    .update({ end_time: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/time-entries");
  revalidatePath("/timer");
}
