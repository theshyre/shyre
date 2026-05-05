"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { serializeAddress } from "@/lib/schemas/address";

function extractAddress(formData: FormData, prefix: string): string | null {
  const address = {
    street: (formData.get(`${prefix}.street`) as string) || "",
    street2: (formData.get(`${prefix}.street2`) as string) || "",
    city: (formData.get(`${prefix}.city`) as string) || "",
    state: (formData.get(`${prefix}.state`) as string) || "",
    postalCode: (formData.get(`${prefix}.postalCode`) as string) || "",
    country: (formData.get(`${prefix}.country`) as string) || "",
  };
  return serializeAddress(address);
}

export async function createCustomerAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    const { userId } = await validateTeamAccess(teamId);

    const name = formData.get("name") as string;
    const email = (formData.get("email") as string) || null;
    const address = extractAddress(formData, "address");
    const notes = (formData.get("notes") as string) || null;
    const rateStr = formData.get("default_rate") as string;
    const default_rate = rateStr ? parseFloat(rateStr) : null;

    assertSupabaseOk(
      await supabase.from("customers").insert({
        team_id: teamId,
        user_id: userId,
        name,
        email,
        address,
        notes,
        default_rate,
      })
    );

    revalidatePath("/customers");
  }, "createCustomerAction") as unknown as void;
}

export async function updateCustomerAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const email = (formData.get("email") as string) || null;
    const address = extractAddress(formData, "address");
    const notes = (formData.get("notes") as string) || null;

    // Checkbox absent from FormData when unchecked; the customer
    // edit form always renders the input, so we treat absence as
    // false. Always set so the user can toggle off.
    const show_country_on_invoice =
      formData.get("show_country_on_invoice") === "on";
    const patch: Record<string, unknown> = {
      name,
      email,
      address,
      notes,
      show_country_on_invoice,
    };

    // payment_terms_days: integer 0..365 inclusive, or null to fall
    // back to team_settings.default_payment_terms_days. Empty string
    // from the form means "Use team default" (the inherit chip).
    if (formData.has("payment_terms_days")) {
      const raw = (formData.get("payment_terms_days") as string).trim();
      patch.payment_terms_days =
        raw === "" ? null : Math.max(0, Math.min(365, parseInt(raw, 10) || 0));
    }

    // Guardrail: honor rate_editability on the default_rate column. See
    // the equivalent guardrail in projects/actions.ts updateProjectAction.
    if (formData.has("default_rate")) {
      const { data: canSet } = await supabase.rpc("can_set_customer_rate", {
        p_customer_id: id,
      });
      if (canSet) {
        const rateStr = formData.get("default_rate") as string;
        patch.default_rate = rateStr ? parseFloat(rateStr) : null;
      }
    }

    assertSupabaseOk(
      await supabase.from("customers").update(patch).eq("id", id),
    );

    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
  }, "updateCustomerAction") as unknown as void;
}

export async function setCustomerRateAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    if (!id) throw new Error("Customer id is required.");

    const { data: canSet } = await supabase.rpc("can_set_customer_rate", {
      p_customer_id: id,
    });
    if (!canSet) {
      throw new Error("Not authorized to set this customer's rate.");
    }

    const rateStr = formData.get("default_rate") as string;
    const default_rate = rateStr ? parseFloat(rateStr) : null;

    assertSupabaseOk(
      await supabase
        .from("customers")
        .update({ default_rate })
        .eq("id", id),
    );

    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
  }, "setCustomerRateAction") as unknown as void;
}

export async function archiveCustomerAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;

    assertSupabaseOk(
      await supabase
        .from("customers")
        .update({ archived: true })
        .eq("id", id)
    );

    revalidatePath("/customers");
  }, "archiveCustomerAction") as unknown as void;
}

/**
 * Bulk archive — used by Pattern B's selection toolbar on the
 * customers list. Reads the multi-valued `id` field from the form
 * (HTML pattern: <input type="hidden" name="id" value="..."> per
 * selected row), and flips `archived = true` on every row at once.
 *
 * RLS gates the actual write per row (customer_permissions admin OR
 * team owner/admin); rows the caller can't archive are silently
 * skipped — same shape as `archiveCustomerAction` for the single
 * row, just batched.
 */
export async function bulkArchiveCustomersAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const ids = formData.getAll("id").map(String).filter(Boolean);
    if (ids.length === 0) return;

    assertSupabaseOk(
      await supabase
        .from("customers")
        .update({ archived: true })
        .in("id", ids),
    );

    revalidatePath("/customers");
  }, "bulkArchiveCustomersAction") as unknown as void;
}

/**
 * Bulk restore — Undo from the bulk-archive toast. Flips
 * `archived = false` on the given ids. Same RLS gating as the
 * archive path; rows the caller can't write to are skipped.
 */
export async function bulkRestoreCustomersAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const ids = formData.getAll("id").map(String).filter(Boolean);
    if (ids.length === 0) return;

    assertSupabaseOk(
      await supabase
        .from("customers")
        .update({ archived: false })
        .in("id", ids),
    );

    revalidatePath("/customers");
  }, "bulkRestoreCustomersAction") as unknown as void;
}
