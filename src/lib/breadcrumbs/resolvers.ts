"use client";

/**
 * Client-side label resolvers for dynamic breadcrumb segments.
 *
 * Each resolver looks up the human-readable name for an entity (e.g.
 * a business id → "Malcom IO LLC"). Returns `null` when the entity
 * isn't readable under RLS or doesn't exist — the renderer falls
 * back to a generic label so a permission failure doesn't crash the
 * breadcrumb.
 *
 * In-memory request-scoped caching is intentionally NOT done here —
 * Next.js client navigations re-run the breadcrumb component, and a
 * stale cache surfaces "the old name" after a rename. The per-page
 * lookup cost is one PK-indexed Supabase round-trip; cheap.
 */

import { createClient } from "@/lib/supabase/client";
import type { DynamicResolverKey } from "./registry";

type Resolver = (id: string) => Promise<string | null>;

async function resolveBusinessName(id: string): Promise<string | null> {
  if (!id) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("businesses")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (error || !data?.name) return null;
  return data.name as string;
}

async function resolveTeamName(id: string): Promise<string | null> {
  if (!id) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("teams")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (error || !data?.name) return null;
  return data.name as string;
}

async function resolveCustomerName(id: string): Promise<string | null> {
  if (!id) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (error || !data?.name) return null;
  return data.name as string;
}

async function resolveProjectName(id: string): Promise<string | null> {
  if (!id) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (error || !data?.name) return null;
  return data.name as string;
}

async function resolveInvoiceNumber(id: string): Promise<string | null> {
  if (!id) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("invoice_number")
    .eq("id", id)
    .maybeSingle();
  if (error || !data?.invoice_number) return null;
  return data.invoice_number as string;
}

const RESOLVERS: Record<DynamicResolverKey, Resolver> = {
  businessName: resolveBusinessName,
  teamName: resolveTeamName,
  customerName: resolveCustomerName,
  projectName: resolveProjectName,
  invoiceNumber: resolveInvoiceNumber,
};

/** Look up an entity name by resolver key + id. Null on miss. */
export async function resolveSegmentLabel(
  key: DynamicResolverKey,
  id: string,
): Promise<string | null> {
  return RESOLVERS[key](id);
}
