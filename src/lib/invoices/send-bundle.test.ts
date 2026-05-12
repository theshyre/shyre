import { describe, it, expect, beforeEach } from "vitest";
import { loadInvoiceSendBundle } from "./send-bundle";

/**
 * `loadInvoiceSendBundle` calls 9 different Supabase tables in
 * parallel + invoice in serial. We don't have a real Supabase here;
 * the helper below builds a fluent mock keyed by table name so each
 * test can vary the rows the orchestrator sees.
 *
 * The orchestrator's chain shape:
 *   - `.from(tbl).select(...).eq(...).single()` for the invoice
 *   - `.from(tbl).select(...).eq(...).order(...)` for line items + recipients
 *   - `.from(tbl).select(...).eq(...).maybeSingle()` for emailConfig + template
 *   - etc.
 * Each call returns `{ data, error }` shaped to match Supabase's contract.
 */

interface MockChain {
  select: () => MockChain;
  eq: () => MockChain;
  order: () => MockChain;
  single: () => Promise<{ data: unknown; error: null }>;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  // `await chain` also works because supabase queries are
  // thenable — duck-type that by making the chain itself a Promise.
  then: <R>(onfulfilled: (v: { data: unknown; error: null }) => R) => Promise<R>;
}

function tableChain(rows: unknown[] | unknown): MockChain {
  const result = { data: rows, error: null as null };
  const chain: MockChain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    single: () => Promise.resolve({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null }),
    maybeSingle: () => Promise.resolve({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null }),
    then: (onfulfilled) => Promise.resolve(result).then(onfulfilled),
  };
  return chain;
}

function fakeSupabase(rowsByTable: Record<string, unknown[] | unknown>): {
  from: (tbl: string) => MockChain;
} {
  return {
    from: (tbl: string) =>
      tableChain(rowsByTable[tbl] ?? []),
  };
}

const baseRows = {
  invoices: {
    id: "inv-1",
    invoice_number: "INV-2026-001",
    team_id: "team-1",
    status: "draft",
    total: 1234.5,
    currency: "USD",
    issued_date: "2026-05-01",
    due_date: "2026-05-15",
    payment_terms_label: "Net 14",
    grouping_mode: "by_project",
    customers: {
      id: "cust-1",
      name: "Acme Corp",
      email: "billing@acme.test",
      address: "1 Main St",
      show_country_on_invoice: false,
    },
  },
  customer_contacts: [] as unknown[],
  invoice_line_items: [
    {
      description: "Line A",
      quantity: 2,
      unit_price: 100,
      amount: 200,
    },
  ],
  team_settings: {
    business_name: "Marcus Consulting",
    business_email: "me@marcus.test",
    business_address: "PO Box 1",
    business_phone: "555",
    wordmark_primary: "MC",
    wordmark_secondary: "",
    brand_color: "#3344FF",
    show_country_on_invoice: true,
  },
  invoice_payments: [{ amount: 100 }],
  time_entries: [] as unknown[],
  team_email_config: null as unknown,
  verified_email_domains: [] as unknown[],
  message_templates: null as unknown,
};

describe("loadInvoiceSendBundle", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://shyre.test";
  });

  it("returns null when the invoice is not found", async () => {
    const supabase = fakeSupabase({ invoices: null });
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "missing",
    );
    expect(bundle).toBeNull();
  });

  it("returns a populated bundle for the happy path", async () => {
    const supabase = fakeSupabase(baseRows);
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle).not.toBeNull();
    expect(bundle!.invoiceId).toBe("inv-1");
    expect(bundle!.invoiceNumber).toBe("INV-2026-001");
    expect(bundle!.teamId).toBe("team-1");
    expect(bundle!.status).toBe("draft");
    expect(bundle!.pdfBundle.invoiceNumber).toBe("INV-2026-001");
    expect(bundle!.pdfBundle.paymentsTotal).toBe(100);
  });

  it("uses customer.email as defaultTo when there are no recipient contacts", async () => {
    const supabase = fakeSupabase(baseRows);
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle!.defaultTo).toBe("billing@acme.test");
  });

  it("uses recipient contacts (joined) as defaultTo when present", async () => {
    const supabase = fakeSupabase({
      ...baseRows,
      customer_contacts: [
        { email: "ap@acme.test" },
        { email: "finance@acme.test" },
      ],
    });
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle!.defaultTo).toBe("ap@acme.test, finance@acme.test");
  });

  it("filters out blank/null contact emails", async () => {
    const supabase = fakeSupabase({
      ...baseRows,
      customer_contacts: [
        { email: "" },
        { email: null },
        { email: "valid@acme.test" },
      ],
    });
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle!.defaultTo).toBe("valid@acme.test");
  });

  it("flags configMissing when team_email_config is absent", async () => {
    const supabase = fakeSupabase(baseRows);
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle!.configMissing).toBe(true);
    expect(bundle!.fromEmail).toBeNull();
  });

  it("flags configMissing when fromEmail is set but the api key is not encrypted/stored", async () => {
    const supabase = fakeSupabase({
      ...baseRows,
      team_email_config: {
        from_email: "billing@marcus.test",
        from_name: "Marcus",
        reply_to_email: null,
        signature: "—",
        api_key_encrypted: null,
      },
    });
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle!.configMissing).toBe(true);
    // domainNotVerified is gated behind !configMissing per the source,
    // so it stays false here even though the domain is unverified.
    expect(bundle!.domainNotVerified).toBe(false);
  });

  it("flags domainNotVerified when from-domain is missing from verified_email_domains", async () => {
    const supabase = fakeSupabase({
      ...baseRows,
      team_email_config: {
        from_email: "billing@marcus.test",
        from_name: "Marcus",
        reply_to_email: "reply@marcus.test",
        signature: "Cheers",
        api_key_encrypted: "<encrypted>",
      },
      verified_email_domains: [{ domain: "other.test", status: "verified" }],
    });
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle!.configMissing).toBe(false);
    expect(bundle!.domainNotVerified).toBe(true);
    expect(bundle!.replyTo).toBe("reply@marcus.test");
    expect(bundle!.signature).toBe("Cheers");
  });

  it("clears domainNotVerified when the matching domain is verified", async () => {
    const supabase = fakeSupabase({
      ...baseRows,
      team_email_config: {
        from_email: "billing@marcus.test",
        from_name: "Marcus",
        reply_to_email: null,
        signature: "",
        api_key_encrypted: "<encrypted>",
      },
      verified_email_domains: [
        // Test the case-insensitive comparison too.
        { domain: "MARCUS.TEST", status: "verified" },
      ],
    });
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle!.domainNotVerified).toBe(false);
  });

  it("renders the message template when one is configured for invoice_send", async () => {
    const supabase = fakeSupabase({
      ...baseRows,
      message_templates: {
        subject: "Hi %customer_name% — invoice %invoice_id%",
        body: "Total due: %invoice_amount%. Thanks, %company_name%",
      },
    });
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle!.renderedSubject).toBe(
      "Hi Acme Corp — invoice INV-2026-001",
    );
    expect(bundle!.renderedBody).toContain("Total due: $1,234.50");
    expect(bundle!.renderedBody).toContain("Marcus Consulting");
  });

  it("renders the default template (with USD formatting) when no message_templates row exists", async () => {
    const supabase = fakeSupabase(baseRows);
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle!.renderedSubject).toContain("INV-2026-001");
    expect(bundle!.renderedSubject).toContain("Marcus Consulting");
    expect(bundle!.renderedBody).toContain("$1,234.50");
    expect(bundle!.renderedBody).toContain("Net 14");
  });

  it("uses the invoice's currency for amount formatting", async () => {
    const supabase = fakeSupabase({
      ...baseRows,
      invoices: { ...baseRows.invoices, total: 999, currency: "EUR" },
    });
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    // Intl.NumberFormat may emit either "€999.00" or "EUR 999.00"
    // depending on the host's CLDR; just assert presence.
    expect(bundle!.renderedBody).toMatch(/EUR|€/);
  });

  it("formats issued_date and due_date as MM/DD/YYYY", async () => {
    const supabase = fakeSupabase(baseRows);
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle!.renderedBody).toContain("05/01/2026");
    expect(bundle!.renderedBody).toContain("05/15/2026");
  });

  it("falls back to stored invoice_line_items when no source time entries exist", async () => {
    const supabase = fakeSupabase(baseRows);
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle!.pdfBundle.lineItems).toEqual([
      { description: "Line A", quantity: 2, unit_price: 100, amount: 200 },
    ]);
  });

  it("re-derives line items from time entries when present (re-group preserves preview-fidelity)", async () => {
    const supabase = fakeSupabase({
      ...baseRows,
      time_entries: [
        {
          id: "te-1",
          user_id: "u-1",
          duration_min: 60,
          description: "Spec",
          start_time: "2026-05-01T09:00:00Z",
          projects: {
            name: "Atlas",
            invoice_code: "ATL",
            hourly_rate: 150,
            customers: { default_rate: null },
          },
          categories: { name: "Design" },
        },
        {
          id: "te-2",
          user_id: "u-1",
          duration_min: 30,
          description: "Spec part 2",
          start_time: "2026-05-02T10:00:00Z",
          projects: {
            name: "Atlas",
            invoice_code: "ATL",
            hourly_rate: 150,
            customers: { default_rate: null },
          },
          categories: { name: "Design" },
        },
      ],
    });
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    // by_project mode collapses both entries onto a single line.
    expect(bundle!.pdfBundle.lineItems.length).toBe(1);
    expect(bundle!.pdfBundle.lineItems[0]!.quantity).toBeCloseTo(1.5);
    expect(bundle!.pdfBundle.lineItems[0]!.unit_price).toBe(150);
  });

  it("propagates the pdfBundle business profile from team_settings", async () => {
    const supabase = fakeSupabase(baseRows);
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle!.pdfBundle.business?.business_name).toBe(
      "Marcus Consulting",
    );
    expect(bundle!.pdfBundle.business?.brand_color).toBe("#3344FF");
  });

  it("sums multiple invoice_payments rows for paymentsTotal", async () => {
    const supabase = fakeSupabase({
      ...baseRows,
      invoice_payments: [{ amount: 250 }, { amount: 75 }, { amount: "100.25" }],
    });
    const bundle = await loadInvoiceSendBundle(
      supabase as unknown as Parameters<typeof loadInvoiceSendBundle>[0],
      "inv-1",
    );
    expect(bundle!.pdfBundle.paymentsTotal).toBeCloseTo(425.25);
  });
});
