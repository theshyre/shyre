"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateOrgAccess } from "@/lib/org-context";
import { revalidatePath } from "next/cache";

/**
 * Create a new (empty) category set in the given org.
 */
export async function createCategorySetAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const orgId = formData.get("organization_id") as string;
    await validateOrgAccess(orgId);

    const name = (formData.get("name") as string)?.trim();
    const description = (formData.get("description") as string) || null;
    if (!name) throw new Error("Set name is required.");

    assertSupabaseOk(
      await supabase.from("category_sets").insert({
        organization_id: orgId,
        name,
        description,
        is_system: false,
        created_by: userId,
      }),
    );
    revalidatePath("/categories");
  }, "createCategorySetAction") as unknown as void;
}

/**
 * Clone a system set into the user's org. Copies all categories.
 */
export async function cloneCategorySetAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const orgId = formData.get("organization_id") as string;
    const sourceId = formData.get("source_id") as string;
    const name = ((formData.get("name") as string) || "").trim();
    await validateOrgAccess(orgId);

    const { data: source, error: srcErr } = await supabase
      .from("category_sets")
      .select("id, name, description")
      .eq("id", sourceId)
      .single();
    if (srcErr || !source) throw new Error("Source set not found.");

    const { data: cats, error: catsErr } = await supabase
      .from("categories")
      .select("name, color, sort_order")
      .eq("category_set_id", sourceId);
    if (catsErr) throw new Error(catsErr.message);

    const { data: created, error: insertErr } = await supabase
      .from("category_sets")
      .insert({
        organization_id: orgId,
        name: name || source.name,
        description: source.description,
        is_system: false,
        created_by: userId,
      })
      .select("id")
      .single();
    if (insertErr || !created) throw new Error(insertErr?.message ?? "Insert failed");

    if (cats && cats.length > 0) {
      assertSupabaseOk(
        await supabase.from("categories").insert(
          cats.map((c) => ({
            category_set_id: created.id,
            name: c.name,
            color: c.color,
            sort_order: c.sort_order,
          })),
        ),
      );
    }

    revalidatePath("/categories");
  }, "cloneCategorySetAction") as unknown as void;
}

export async function updateCategorySetAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    const orgId = formData.get("organization_id") as string;
    await validateOrgAccess(orgId);

    const name = (formData.get("name") as string)?.trim();
    const description = (formData.get("description") as string) || null;
    if (!name) throw new Error("Set name is required.");

    assertSupabaseOk(
      await supabase
        .from("category_sets")
        .update({ name, description })
        .eq("id", id)
        .eq("organization_id", orgId),
    );
    revalidatePath("/categories");
  }, "updateCategorySetAction") as unknown as void;
}

export async function deleteCategorySetAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    const orgId = formData.get("organization_id") as string;
    await validateOrgAccess(orgId);

    assertSupabaseOk(
      await supabase
        .from("category_sets")
        .delete()
        .eq("id", id)
        .eq("organization_id", orgId),
    );
    revalidatePath("/categories");
  }, "deleteCategorySetAction") as unknown as void;
}

export async function createCategoryAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const setId = formData.get("category_set_id") as string;
    const name = (formData.get("name") as string)?.trim();
    const color = ((formData.get("color") as string) || "#6b7280").trim();
    const sortStr = formData.get("sort_order") as string;
    const sort_order = sortStr ? parseInt(sortStr, 10) : 0;
    if (!name) throw new Error("Category name is required.");

    assertSupabaseOk(
      await supabase.from("categories").insert({
        category_set_id: setId,
        name,
        color,
        sort_order,
      }),
    );
    revalidatePath("/categories");
  }, "createCategoryAction") as unknown as void;
}

export async function updateCategoryAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    const name = (formData.get("name") as string)?.trim();
    const color = (formData.get("color") as string) || "#6b7280";
    const sortStr = formData.get("sort_order") as string;
    const sort_order = sortStr ? parseInt(sortStr, 10) : 0;
    if (!name) throw new Error("Category name is required.");

    assertSupabaseOk(
      await supabase
        .from("categories")
        .update({ name, color, sort_order })
        .eq("id", id),
    );
    revalidatePath("/categories");
  }, "updateCategoryAction") as unknown as void;
}

export async function deleteCategoryAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    assertSupabaseOk(await supabase.from("categories").delete().eq("id", id));
    revalidatePath("/categories");
  }, "deleteCategoryAction") as unknown as void;
}
