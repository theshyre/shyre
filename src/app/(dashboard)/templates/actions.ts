"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateOrgAccess } from "@/lib/org-context";
import { revalidatePath } from "next/cache";

export async function createTemplateAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const orgId = formData.get("organization_id") as string;
    await validateOrgAccess(orgId);

    const name = (formData.get("name") as string)?.trim();
    const project_id = formData.get("project_id") as string;
    const category_id = (formData.get("category_id") as string) || null;
    const description = (formData.get("description") as string) || null;
    const billable = formData.get("billable") === "on";
    const sortStr = formData.get("sort_order") as string;
    const sort_order = sortStr ? parseInt(sortStr, 10) : 0;
    if (!name) throw new Error("Template name is required.");
    if (!project_id) throw new Error("Project is required.");

    assertSupabaseOk(
      await supabase.from("time_templates").insert({
        organization_id: orgId,
        user_id: userId,
        project_id,
        category_id,
        name,
        description,
        billable,
        sort_order,
      }),
    );
    revalidatePath("/templates");
    revalidatePath("/time-entries");
  }, "createTemplateAction") as unknown as void;
}

export async function updateTemplateAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const id = formData.get("id") as string;
    const name = (formData.get("name") as string)?.trim();
    const project_id = formData.get("project_id") as string;
    const category_id = (formData.get("category_id") as string) || null;
    const description = (formData.get("description") as string) || null;
    const billable = formData.get("billable") === "on";
    const sortStr = formData.get("sort_order") as string;
    const sort_order = sortStr ? parseInt(sortStr, 10) : 0;
    if (!name) throw new Error("Template name is required.");
    if (!project_id) throw new Error("Project is required.");

    assertSupabaseOk(
      await supabase
        .from("time_templates")
        .update({
          name,
          project_id,
          category_id,
          description,
          billable,
          sort_order,
        })
        .eq("id", id)
        .eq("user_id", userId),
    );
    revalidatePath("/templates");
    revalidatePath("/time-entries");
  }, "updateTemplateAction") as unknown as void;
}

export async function deleteTemplateAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const id = formData.get("id") as string;
    assertSupabaseOk(
      await supabase
        .from("time_templates")
        .delete()
        .eq("id", id)
        .eq("user_id", userId),
    );
    revalidatePath("/templates");
    revalidatePath("/time-entries");
  }, "deleteTemplateAction") as unknown as void;
}

/**
 * Start a running timer from a template. Stops any existing running timer
 * for this user first, updates last_used_at.
 */
export async function startFromTemplateAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const templateId = formData.get("template_id") as string;

    const { data: tpl, error: tplErr } = await supabase
      .from("time_templates")
      .select(
        "organization_id, project_id, category_id, description, billable",
      )
      .eq("id", templateId)
      .eq("user_id", userId)
      .single();
    if (tplErr || !tpl) throw new Error("Template not found");

    const now = new Date().toISOString();

    // Stop any running timer for this user
    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .update({ end_time: now })
        .eq("user_id", userId)
        .is("end_time", null),
    );

    // Insert new running entry from template
    assertSupabaseOk(
      await supabase.from("time_entries").insert({
        organization_id: tpl.organization_id,
        user_id: userId,
        project_id: tpl.project_id,
        category_id: tpl.category_id,
        description: tpl.description,
        start_time: now,
        end_time: null,
        billable: tpl.billable,
      }),
    );

    // Bump last_used_at
    await supabase
      .from("time_templates")
      .update({ last_used_at: now })
      .eq("id", templateId)
      .eq("user_id", userId);

    revalidatePath("/time-entries");
  }, "startFromTemplateAction") as unknown as void;
}
