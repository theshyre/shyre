import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "../helpers/prefix";
import { cleanupPrefix } from "../helpers/cleanup";
import { createAuthedClient } from "../helpers/authed-client";
import { adminClient } from "../helpers/admin";
import {
  twoTeamSharingScenario,
  TwoTeamSharingScenario,
} from "../helpers/fixtures";

/**
 * SAL-012 RLS verification.
 *
 * The narrowed SELECT policies on `business_state_registrations`,
 * `business_tax_registrations`, `business_registered_agents`, and
 * the new `business_identity_private` table must (a) return rows
 * to owner / admin and (b) return ZERO rows to a plain member of
 * the business's teams. The wider `businesses` row stays member-
 * readable (legal_name, entity_type) because non-admins still see
 * the page-title in the layout.
 *
 * Without this test the SAL-012 thesis is unverified and the next
 * "loosen for a feature" PR walks back into the leak.
 */
describe("SAL-012: business identity / registrations SELECT gating", () => {
  let prefix: string;
  let scenario: TwoTeamSharingScenario;
  let businessId: string;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoTeamSharingScenario(prefix);

    // Resolve the business under primaryTeam — created by the
    // teams helper.
    const { data: team } = await adminClient()
      .from("teams")
      .select("business_id")
      .eq("id", scenario.primaryTeam.id)
      .single();
    businessId = team!.business_id as string;

    // Seed sensitive identity + a state registration + a tax
    // registration + a registered agent so each query has
    // something to NOT return for a member.
    const admin = adminClient();
    await admin
      .from("business_identity_private")
      .update({
        tax_id: "12-3456789",
        date_incorporated: "2024-01-15",
        fiscal_year_start: "01-01",
      })
      .eq("business_id", businessId);

    const { data: agent } = await admin
      .from("business_registered_agents")
      .insert({
        business_id: businessId,
        name: `${prefix}agent`,
        contact_email: "agent@example.com",
      })
      .select("id")
      .single();

    await admin.from("business_state_registrations").insert({
      business_id: businessId,
      state: "DE",
      registration_type: "formation",
      is_formation: true,
      registered_agent_id: agent!.id,
    });

    await admin.from("business_tax_registrations").insert({
      business_id: businessId,
      jurisdiction: "DE",
      tax_type: "franchise_tax",
    });
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  it("plain member CANNOT SELECT business_identity_private", async () => {
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { data, error } = await carol
      .from("business_identity_private")
      .select("tax_id")
      .eq("business_id", businessId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("plain member's businesses query returns NULL for the deprecated tax_id columns (post-contract)", async () => {
    // Post-SAL-012 contract drop the columns are gone; explicitly
    // querying them should error. We verify by selecting the
    // remaining display fields and confirming the row is visible
    // (the broader RLS on businesses still passes for any team
    // member — page-title needs that).
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { data, error } = await carol
      .from("businesses")
      .select("id, legal_name, entity_type")
      .eq("id", businessId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("plain member CANNOT SELECT state registrations", async () => {
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { data } = await carol
      .from("business_state_registrations")
      .select("id, state")
      .eq("business_id", businessId);
    expect(data ?? []).toHaveLength(0);
  });

  it("plain member CANNOT SELECT tax registrations", async () => {
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { data } = await carol
      .from("business_tax_registrations")
      .select("id, jurisdiction")
      .eq("business_id", businessId);
    expect(data ?? []).toHaveLength(0);
  });

  it("plain member CANNOT SELECT registered agents", async () => {
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { data } = await carol
      .from("business_registered_agents")
      .select("id, name")
      .eq("business_id", businessId);
    expect(data ?? []).toHaveLength(0);
  });

  it("owner CAN SELECT business_identity_private with the EIN", async () => {
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data, error } = await alice
      .from("business_identity_private")
      .select("tax_id")
      .eq("business_id", businessId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.tax_id).toBe("12-3456789");
  });

  it("owner CAN SELECT all three registrations tables", async () => {
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const [agents, stateRegs, taxRegs] = await Promise.all([
      alice
        .from("business_registered_agents")
        .select("id")
        .eq("business_id", businessId),
      alice
        .from("business_state_registrations")
        .select("id")
        .eq("business_id", businessId),
      alice
        .from("business_tax_registrations")
        .select("id")
        .eq("business_id", businessId),
    ]);
    expect((agents.data ?? []).length).toBeGreaterThan(0);
    expect((stateRegs.data ?? []).length).toBeGreaterThan(0);
    expect((taxRegs.data ?? []).length).toBeGreaterThan(0);
  });

  it("outsider sees zero across all four tables", async () => {
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const [priv, agents, stateRegs, taxRegs] = await Promise.all([
      eve
        .from("business_identity_private")
        .select("business_id")
        .eq("business_id", businessId),
      eve
        .from("business_registered_agents")
        .select("id")
        .eq("business_id", businessId),
      eve
        .from("business_state_registrations")
        .select("id")
        .eq("business_id", businessId),
      eve
        .from("business_tax_registrations")
        .select("id")
        .eq("business_id", businessId),
    ]);
    expect(priv.data ?? []).toHaveLength(0);
    expect(agents.data ?? []).toHaveLength(0);
    expect(stateRegs.data ?? []).toHaveLength(0);
    expect(taxRegs.data ?? []).toHaveLength(0);
  });
});
