import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrapEmbed } from "@/lib/supabase/embed";

/**
 * Shared loader for a proposal's signer roster (`proposal_signers` +
 * `customer_contacts` embed), previously duplicated by the detail and preview
 * pages. Takes the CALLER's supabase client so visibility stays RLS-scoped —
 * this must never widen to the admin client.
 */

export interface ProposalRosterEntry {
  /** proposal_signers.id — the key acceptance rows reference via signer_id. */
  id: string;
  name: string;
  email: string;
  roleLabel: string | null;
}

interface RosterContactEmbed {
  name: string | null;
  email: string | null;
  role_label: string | null;
}

/** Roster entries in signing order (sort_order asc; entry 0 = primary).
 *  Missing contact fields fall back to the display placeholders the pages
 *  render ("—" name, empty email). */
export async function loadProposalRoster(
  supabase: SupabaseClient,
  proposalId: string,
): Promise<ProposalRosterEntry[]> {
  const { data } = await supabase
    .from("proposal_signers")
    .select("id, sort_order, customer_contacts(name, email, role_label)")
    .eq("proposal_id", proposalId)
    .order("sort_order");
  return (data ?? []).map((row) => {
    const contact = unwrapEmbed(
      row.customer_contacts as
        | RosterContactEmbed
        | RosterContactEmbed[]
        | null,
    );
    return {
      id: row.id as string,
      name: contact?.name ?? "—",
      email: contact?.email ?? "",
      roleLabel: contact?.role_label ?? null,
    };
  });
}
