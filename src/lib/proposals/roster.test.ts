import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadProposalRoster } from "./roster";

interface QueryLog {
  table?: string;
  select?: string;
  eq?: [string, unknown];
  order?: string;
}

/** Minimal chainable stub for the single roster query. */
function stubClient(
  rows: Array<Record<string, unknown>> | null,
  log: QueryLog = {},
): SupabaseClient {
  const builder = {
    select: (cols: string) => {
      log.select = cols;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      log.eq = [col, val];
      return builder;
    },
    order: (col: string) => {
      log.order = col;
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return {
    from: (table: string) => {
      log.table = table;
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe("loadProposalRoster", () => {
  it("queries proposal_signers scoped to the proposal, ordered by sort_order", async () => {
    const log: QueryLog = {};
    await loadProposalRoster(stubClient([], log), "prop-1");
    expect(log.table).toBe("proposal_signers");
    expect(log.select).toBe(
      "id, sort_order, customer_contacts(name, email, role_label)",
    );
    expect(log.eq).toEqual(["proposal_id", "prop-1"]);
    expect(log.order).toBe("sort_order");
  });

  it("unwraps object-shaped contact embeds", async () => {
    const roster = await loadProposalRoster(
      stubClient([
        {
          id: "s1",
          sort_order: 0,
          customer_contacts: {
            name: "Jordan Chen",
            email: "jordan@acme.example",
            role_label: "CTO",
          },
        },
      ]),
      "prop-1",
    );
    expect(roster).toEqual([
      {
        id: "s1",
        name: "Jordan Chen",
        email: "jordan@acme.example",
        roleLabel: "CTO",
      },
    ]);
  });

  it("unwraps array-shaped contact embeds and preserves row order", async () => {
    const roster = await loadProposalRoster(
      stubClient([
        {
          id: "s1",
          sort_order: 0,
          customer_contacts: [
            { name: "Primary", email: "p@acme.example", role_label: null },
          ],
        },
        {
          id: "s2",
          sort_order: 1,
          customer_contacts: [
            { name: "Co-signer", email: "c@acme.example", role_label: "CFO" },
          ],
        },
      ]),
      "prop-1",
    );
    expect(roster.map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(roster[1]).toEqual({
      id: "s2",
      name: "Co-signer",
      email: "c@acme.example",
      roleLabel: "CFO",
    });
  });

  it("falls back to display placeholders when the contact embed is missing", async () => {
    const roster = await loadProposalRoster(
      stubClient([{ id: "s1", sort_order: 0, customer_contacts: null }]),
      "prop-1",
    );
    expect(roster).toEqual([
      { id: "s1", name: "—", email: "", roleLabel: null },
    ]);
  });

  it("returns an empty roster when no rows come back", async () => {
    expect(await loadProposalRoster(stubClient(null), "prop-1")).toEqual([]);
  });
});
