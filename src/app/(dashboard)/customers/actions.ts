"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { isTeamAdmin, validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { serializeAddress } from "@/lib/schemas/address";
import { isOwnBrandingUrl } from "@/lib/branding/branding-url";

const HEX_COLOR = /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/;

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

    // Co-brand accent: hex or null. The DB CHECK is the backstop; validate
    // here for a friendly message rather than a raw constraint violation.
    if (formData.has("accent_color")) {
      const raw = (formData.get("accent_color") as string).trim();
      if (raw !== "" && !HEX_COLOR.test(raw)) {
        throw new Error("Accent color must be a hex value like #2563EB.");
      }
      patch.accent_color = raw === "" ? null : raw;
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

/**
 * Persist (or clear) a customer's co-brand logo. Uploaded client-side to the
 * shared `branding` bucket under `<team_id>/customers/<id>/…`; this stores the
 * public URL onto `customers.logo_url`. Owner/admin-gated (matching the bucket
 * RLS) and the URL is validated to be the customer's own team branding upload
 * — an off-site or foreign-team URL is refused (SAL-041, SAL-039 image lesson).
 */
export async function setCustomerLogoAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const customerId = formData.get("customer_id") as string;
    if (!customerId) throw new Error("Missing customer id.");

    const { data: customer } = await supabase
      .from("customers")
      .select("id, team_id")
      .eq("id", customerId)
      .single();
    if (!customer) throw new Error("Customer not found.");
    const teamId = customer.team_id as string;
    const { role } = await validateTeamAccess(teamId);
    if (!isTeamAdmin(role)) {
      throw new Error("Only owners and admins can change a customer logo.");
    }

    const raw = (formData.get("logo_url") as string | null)?.trim() || null;
    if (raw !== null && !isOwnBrandingUrl(raw, teamId)) {
      throw new Error("That logo URL is not a valid upload for this team.");
    }
    assertSupabaseOk(
      await supabase.from("customers").update({ logo_url: raw }).eq("id", customerId),
    );
    revalidatePath(`/customers/${customerId}`);
  }, "setCustomerLogoAction") as unknown as void;
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

/**
 * Mark a customer inactive / active again (2026-07-18 lifecycle feature).
 * Non-destructive and freely reversible — the customer stays fully visible
 * (badged) and history untouched; only new-work pickers demote them. The
 * timestamp form answers "inactive since when?" (bounced_at precedent).
 * Idempotent: re-deactivating keeps the ORIGINAL timestamp (`inactive_at
 * IS NULL` predicate) so bulk sweeps can't quietly rewrite history.
 */
export async function deactivateCustomerAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const ids = formData.getAll("id").map(String).filter(Boolean);
    if (ids.length === 0) return;
    assertSupabaseOk(
      await supabase
        .from("customers")
        .update({ inactive_at: new Date().toISOString() })
        .in("id", ids)
        .is("inactive_at", null),
    );
    revalidatePath("/customers");
    for (const id of ids) revalidatePath(`/customers/${id}`);
  }, "deactivateCustomerAction") as unknown as void;
}

export async function reactivateCustomerAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const ids = formData.getAll("id").map(String).filter(Boolean);
    if (ids.length === 0) return;
    assertSupabaseOk(
      await supabase
        .from("customers")
        .update({ inactive_at: null })
        .in("id", ids),
    );
    revalidatePath("/customers");
    for (const id of ids) revalidatePath(`/customers/${id}`);
  }, "reactivateCustomerAction") as unknown as void;
}
