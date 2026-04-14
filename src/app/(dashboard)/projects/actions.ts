"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateOrgAccess } from "@/lib/org-context";
import { revalidatePath } from "next/cache";

export async function createProjectAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const orgId = formData.get("organization_id") as string;
    const { userId } = await validateOrgAccess(orgId);

    const name = formData.get("name") as string;
    const client_id = (formData.get("client_id") as string) || null;
    const description = (formData.get("description") as string) || null;
    const rateStr = formData.get("hourly_rate") as string;
    const hourly_rate = rateStr ? parseFloat(rateStr) : null;
    const budgetStr = formData.get("budget_hours") as string;
    const budget_hours = budgetStr ? parseFloat(budgetStr) : null;
    const github_repo = (formData.get("github_repo") as string) || null;
    const category_set_id = (formData.get("category_set_id") as string) || null;

    assertSupabaseOk(
      await supabase.from("projects").insert({
        organization_id: orgId,
        user_id: userId,
        client_id,
        name,
        description,
        hourly_rate,
        budget_hours,
        github_repo,
        category_set_id,
      })
    );

    revalidatePath("/projects");
    if (client_id) revalidatePath(`/clients/${client_id}`);
  }, "createProjectAction") as unknown as void;
}

export async function updateProjectAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const description = (formData.get("description") as string) || null;
    const rateStr = formData.get("hourly_rate") as string;
    const hourly_rate = rateStr ? parseFloat(rateStr) : null;
    const budgetStr = formData.get("budget_hours") as string;
    const budget_hours = budgetStr ? parseFloat(budgetStr) : null;
    const github_repo = (formData.get("github_repo") as string) || null;
    const status = formData.get("status") as string;
    const category_set_id = (formData.get("category_set_id") as string) || null;

    assertSupabaseOk(
      await supabase
        .from("projects")
        .update({
          name,
          description,
          hourly_rate,
          budget_hours,
          github_repo,
          status,
          category_set_id,
        })
        .eq("id", id)
    );

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
  }, "updateProjectAction") as unknown as void;
}
