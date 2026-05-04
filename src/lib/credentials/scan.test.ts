import { describe, it, expect } from "vitest";

// Pure helpers exported indirectly via the module: severityFor +
// sortItems are internal. We validate behavior end-to-end by
// passing a mocked supabase client through scanCredentials, which
// exercises both. Also imports the module to keep coverage real.
import { scanCredentials, type CredentialItem } from "./scan";

interface MockRow {
  table: string;
  data: unknown;
}

function mockSupabase(rows: MockRow[]) {
  return {
    from(table: string) {
      const row = rows.find((r) => r.table === table);
      const data = row?.data ?? null;
      const chain: Record<string, unknown> = {};
      // Each query in scan.ts ends in either .maybeSingle() or
      // a raw select-then-await. We mock both shapes by making
      // the chain `await`-able AND having `.maybeSingle()` on it.
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data });
      // Make the chain itself await-able for the .select() ones
      // that don't terminate in maybeSingle.
      (chain as { then?: unknown }).then = (
        resolve: (v: { data: unknown }) => void,
      ) => resolve({ data });
      return chain;
    },
  } as unknown as Parameters<typeof scanCredentials>[0];
}

const TODAY = new Date();
function isoOffset(days: number): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("scanCredentials", () => {
  it("returns nothing when no credentials are saved", async () => {
    const supabase = mockSupabase([
      { table: "instance_deploy_config", data: null },
      { table: "team_email_config", data: [] },
      { table: "user_settings", data: [] },
    ]);
    const items = await scanCredentials(supabase);
    expect(items).toEqual([]);
  });

  it("classifies severity by days-until-expiry", async () => {
    const supabase = mockSupabase([
      {
        table: "instance_deploy_config",
        data: {
          api_token: "vt_present",
          api_token_expires_at: isoOffset(3), // critical (≤7d)
        },
      },
      {
        table: "team_email_config",
        data: [
          {
            team_id: "team-warn",
            api_key_encrypted: Buffer.from([1]),
            api_key_expires_at: isoOffset(20), // warning (≤30d)
            teams: { name: "Warning Co" },
          },
          {
            team_id: "team-ok",
            api_key_encrypted: Buffer.from([1]),
            api_key_expires_at: isoOffset(120), // ok
            teams: { name: "Healthy Co" },
          },
          {
            team_id: "team-expired",
            api_key_encrypted: Buffer.from([1]),
            api_key_expires_at: isoOffset(-5), // expired
            teams: { name: "Past Due Co" },
          },
        ],
      },
      { table: "user_settings", data: [] },
    ]);
    const items = await scanCredentials(supabase);

    const byTeam = (k: string) =>
      items.find(
        (i) => i.kind === "resend_api_key" && i.scopeId === k,
      );

    expect(items.find((i) => i.kind === "vercel_api_token")?.severity).toBe(
      "critical",
    );
    expect(byTeam("team-warn")?.severity).toBe("warning");
    expect(byTeam("team-ok")?.severity).toBe("ok");
    expect(byTeam("team-expired")?.severity).toBe("expired");
    expect(byTeam("team-expired")?.daysUntilExpiry).toBe(-5);
  });

  it("sorts expired first, then by days-until-expiry within severity", async () => {
    const supabase = mockSupabase([
      {
        table: "instance_deploy_config",
        data: {
          api_token: "vt",
          api_token_expires_at: isoOffset(30), // warning
        },
      },
      {
        table: "team_email_config",
        data: [
          {
            team_id: "exp",
            api_key_encrypted: Buffer.from([1]),
            api_key_expires_at: isoOffset(-1), // expired
            teams: { name: "Exp" },
          },
          {
            team_id: "crit-3",
            api_key_encrypted: Buffer.from([1]),
            api_key_expires_at: isoOffset(3), // critical
            teams: { name: "C3" },
          },
          {
            team_id: "crit-1",
            api_key_encrypted: Buffer.from([1]),
            api_key_expires_at: isoOffset(1), // critical, sooner
            teams: { name: "C1" },
          },
        ],
      },
      { table: "user_settings", data: [] },
    ]);
    const items = await scanCredentials(supabase);
    expect(items.map((i) => i.severity)).toEqual([
      "expired",
      "critical",
      "critical",
      "warning",
    ]);
    // Within critical, the 1-day item beats the 3-day item.
    const criticals = items.filter((i) => i.severity === "critical");
    expect(criticals[0]?.scopeId).toBe("crit-1");
    expect(criticals[1]?.scopeId).toBe("crit-3");
  });

  it("skips credentials whose secret is null (not saved yet)", async () => {
    const supabase = mockSupabase([
      {
        table: "instance_deploy_config",
        data: { api_token: null, api_token_expires_at: null },
      },
      {
        table: "team_email_config",
        data: [
          {
            team_id: "team-a",
            api_key_encrypted: null, // not saved
            api_key_expires_at: null,
            teams: { name: "Empty Co" },
          },
        ],
      },
      { table: "user_settings", data: [] },
    ]);
    const items = await scanCredentials(supabase);
    expect(items).toEqual([]);
  });

  it("treats missing expires_at as severity=ok (no banner) but keeps the row", async () => {
    const supabase = mockSupabase([
      {
        table: "instance_deploy_config",
        data: { api_token: "vt", api_token_expires_at: null },
      },
      { table: "team_email_config", data: [] },
      { table: "user_settings", data: [] },
    ]);
    const items = await scanCredentials(supabase);
    expect(items).toHaveLength(1);
    expect(items[0]?.severity).toBe("ok");
    expect(items[0]?.expiresAt).toBeNull();
    expect(items[0]?.daysUntilExpiry).toBeNull();
  });

  it("populates a per-credential editUrl", async () => {
    const supabase = mockSupabase([
      {
        table: "instance_deploy_config",
        data: { api_token: "vt", api_token_expires_at: isoOffset(10) },
      },
      {
        table: "team_email_config",
        data: [
          {
            team_id: "team-x",
            api_key_encrypted: Buffer.from([1]),
            api_key_expires_at: isoOffset(10),
            teams: { name: "X" },
          },
        ],
      },
      { table: "user_settings", data: [] },
    ]);
    const items: CredentialItem[] = await scanCredentials(supabase);
    expect(items.find((i) => i.kind === "vercel_api_token")?.editUrl).toBe(
      "/system/deploy",
    );
    expect(items.find((i) => i.kind === "resend_api_key")?.editUrl).toBe(
      "/teams/team-x/email#config",
    );
  });
});
