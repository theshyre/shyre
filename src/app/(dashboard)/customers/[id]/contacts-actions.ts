"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk, AppError } from "@/lib/errors";
import { isTeamAdmin, validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";

/**
 * Customer-contacts actions.
 *
 * Surfaces a *people* layer over the existing customer record:
 * AP manager, project sponsor, founder, etc. The send-invoice
 * flow's To: field pre-fills from whichever contact is flagged
 * `is_invoice_recipient` (one per customer; partial unique index
 * enforces it at the DB layer).
 *
 * RLS does the heavy lifting — every policy gates on
 * `user_team_role(team_id) IN ('owner','admin')` for writes.
 * The `validateTeamAccess` + `isTeamAdmin` early checks are for
 * better error copy and to fail before round-tripping the DB.
 */

interface CustomerLookup {
  team_id: string;
  id: string;
}

async function loadCustomerForAdmin(
  supabase: Awaited<
    ReturnType<typeof import("@/lib/supabase/server").createClient>
  >,
  customerId: string,
): Promise<CustomerLookup> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, team_id")
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw AppError.notFound("Customer");

  const { role } = await validateTeamAccess(data.team_id as string);
  if (!isTeamAdmin(role)) {
    throw AppError.refusal(
      "Only team owners and admins can manage customer contacts.",
    );
  }
  return { team_id: data.team_id as string, id: data.id as string };
}

export async function createCustomerContactAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const customerId = (formData.get("customer_id") as string) ?? "";
      if (!customerId) throw new Error("customer_id is required.");
      const { team_id } = await loadCustomerForAdmin(supabase, customerId);

      const name = ((formData.get("name") as string) ?? "").trim();
      const email = ((formData.get("email") as string) ?? "").trim();
      const roleLabel =
        ((formData.get("role_label") as string) ?? "").trim() || null;
      const isInvoiceRecipient =
        formData.get("is_invoice_recipient") === "true";

      if (!name) throw new Error("Name is required.");
      if (!email) throw new Error("Email is required.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error(`"${email}" is not a valid email address.`);
      }

      // If this contact is being marked as the invoice recipient,
      // clear the previous one to avoid violating the partial
      // unique index.
      if (isInvoiceRecipient) {
        assertSupabaseOk(
          await supabase
            .from("customer_contacts")
            .update({ is_invoice_recipient: false })
            .eq("customer_id", customerId)
            .eq("is_invoice_recipient", true),
        );
      }

      assertSupabaseOk(
        await supabase.from("customer_contacts").insert({
          team_id,
          customer_id: customerId,
          name,
          email,
          role_label: roleLabel,
          is_invoice_recipient: isInvoiceRecipient,
        }),
      );

      revalidatePath(`/customers/${customerId}`);
    },
    "createCustomerContactAction",
  ) as unknown as void;
}

export async function updateCustomerContactAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const contactId = (formData.get("contact_id") as string) ?? "";
      if (!contactId) throw new Error("contact_id is required.");

      // Load the contact to find its customer / team scope, then
      // gate via the customer-admin helper.
      const { data: existing, error: loadErr } = await supabase
        .from("customer_contacts")
        .select("id, customer_id, team_id")
        .eq("id", contactId)
        .maybeSingle();
      if (loadErr) throw loadErr;
      if (!existing) throw AppError.notFound("Contact");

      await loadCustomerForAdmin(
        supabase,
        existing.customer_id as string,
      );

      const name = ((formData.get("name") as string) ?? "").trim();
      const email = ((formData.get("email") as string) ?? "").trim();
      const roleLabel =
        ((formData.get("role_label") as string) ?? "").trim() || null;
      const isInvoiceRecipient =
        formData.get("is_invoice_recipient") === "true";

      if (!name) throw new Error("Name is required.");
      if (!email) throw new Error("Email is required.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error(`"${email}" is not a valid email address.`);
      }

      if (isInvoiceRecipient) {
        // Clear any other recipient on the same customer — the
        // partial unique index would reject the update otherwise.
        assertSupabaseOk(
          await supabase
            .from("customer_contacts")
            .update({ is_invoice_recipient: false })
            .eq("customer_id", existing.customer_id as string)
            .eq("is_invoice_recipient", true)
            .neq("id", contactId),
        );
      }

      assertSupabaseOk(
        await supabase
          .from("customer_contacts")
          .update({
            name,
            email,
            role_label: roleLabel,
            is_invoice_recipient: isInvoiceRecipient,
          })
          .eq("id", contactId),
      );

      revalidatePath(`/customers/${existing.customer_id as string}`);
    },
    "updateCustomerContactAction",
  ) as unknown as void;
}

export async function deleteCustomerContactAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const contactId = (formData.get("contact_id") as string) ?? "";
      if (!contactId) throw new Error("contact_id is required.");

      const { data: existing, error: loadErr } = await supabase
        .from("customer_contacts")
        .select("id, customer_id, team_id")
        .eq("id", contactId)
        .maybeSingle();
      if (loadErr) throw loadErr;
      if (!existing) throw AppError.notFound("Contact");

      await loadCustomerForAdmin(
        supabase,
        existing.customer_id as string,
      );

      assertSupabaseOk(
        await supabase.from("customer_contacts").delete().eq("id", contactId),
      );

      revalidatePath(`/customers/${existing.customer_id as string}`);
    },
    "deleteCustomerContactAction",
  ) as unknown as void;
}

/** Toggle a contact's recipient flag. The partial unique index
 *  enforces "at most one per customer" — this action clears the
 *  previous recipient (if any) before setting the new one, so a
 *  team admin's click never trips the index. */
export async function setInvoiceRecipientAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (formData, { supabase }) => {
      const contactId = (formData.get("contact_id") as string) ?? "";
      if (!contactId) throw new Error("contact_id is required.");

      const { data: existing, error: loadErr } = await supabase
        .from("customer_contacts")
        .select("id, customer_id, team_id, is_invoice_recipient")
        .eq("id", contactId)
        .maybeSingle();
      if (loadErr) throw loadErr;
      if (!existing) throw AppError.notFound("Contact");

      await loadCustomerForAdmin(
        supabase,
        existing.customer_id as string,
      );

      // Clear the existing recipient(s) for this customer first.
      assertSupabaseOk(
        await supabase
          .from("customer_contacts")
          .update({ is_invoice_recipient: false })
          .eq("customer_id", existing.customer_id as string)
          .eq("is_invoice_recipient", true),
      );

      // Then set the chosen contact. If the user clicks the
      // already-recipient contact, this leaves it cleared (toggle
      // off semantics). If they click a different contact, this
      // sets the new one.
      if (!existing.is_invoice_recipient) {
        assertSupabaseOk(
          await supabase
            .from("customer_contacts")
            .update({ is_invoice_recipient: true })
            .eq("id", contactId),
        );
      }

      revalidatePath(`/customers/${existing.customer_id as string}`);
    },
    "setInvoiceRecipientAction",
  ) as unknown as void;
}
