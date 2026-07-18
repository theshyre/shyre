import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard for the 2026-07-18 Archived-tab bug: the no-org query
 * branch hard-coded `.eq("archived", false)` and omitted `inactive_at`,
 * so /customers?status=archived (no ?org=) re-fetched ACTIVE customers
 * and the table badged them all "Archived" — a lying restore surface.
 *
 * page.tsx is a server component the vitest harness can't render, so this
 * is a static source assertion (same spirit as src/__tests__/view-parity):
 * every customers_v list query in the page must respect the status chip.
 */
const src = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("customers page status filter parity (org and no-org branches)", () => {
  it("never hard-codes the archived filter — both branches use showArchived", () => {
    expect(src).not.toMatch(/\.eq\("archived",\s*(?:true|false)\)/);
    const dynamic = src.match(/\.eq\("archived", showArchived\)/g) ?? [];
    expect(dynamic.length).toBeGreaterThanOrEqual(2);
  });

  it("every customers_v select carries inactive_at (Active/Inactive chips filter on it)", () => {
    const selects = src.match(/"[^"]*id, team_id, name[^"]*"/g) ?? [];
    expect(selects.length).toBeGreaterThanOrEqual(3);
    for (const s of selects) {
      expect(s).toContain("inactive_at");
    }
  });
});
