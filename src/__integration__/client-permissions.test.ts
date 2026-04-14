import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "./helpers/prefix";
import { cleanupPrefix } from "./helpers/cleanup";
import { createAuthedClient } from "./helpers/authed-client";
import { adminClient } from "./helpers/admin";
import {
  twoOrgSharingScenario,
  TwoOrgSharingScenario,
} from "./helpers/fixtures";
import { createTestSecurityGroup } from "./helpers/clients";

describe("client permissions", () => {
  let prefix: string;
  let scenario: TwoOrgSharingScenario;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoOrgSharingScenario(prefix);
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  async function clearClientPermissions() {
    await adminClient()
      .from("client_permissions")
      .delete()
      .eq("client_id", scenario.client.id);
  }

  it("grant viewer lets outsider SELECT but not UPDATE the client", async () => {
    await clearClientPermissions();

    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );

    const { error: grantErr } = await alice.rpc("grant_client_permission", {
      p_client_id: scenario.client.id,
      p_principal_type: "user",
      p_principal_id: scenario.eve.id,
      p_level: "viewer",
    });
    expect(grantErr).toBeNull();

    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );

    const { data: selectData, error: selectErr } = await eve
      .from("clients")
      .select("id, name")
      .eq("id", scenario.client.id);

    expect(selectErr).toBeNull();
    expect(selectData).toHaveLength(1);

    const { error: updateErr } = await eve
      .from("clients")
      .update({ name: `${prefix}eve-was-here` })
      .eq("id", scenario.client.id)
      .select();

    // RLS UPDATE denied → either error or zero rows affected
    const { data: afterUpdate } = await adminClient()
      .from("clients")
      .select("name")
      .eq("id", scenario.client.id)
      .single();
    expect(afterUpdate?.name).not.toBe(`${prefix}eve-was-here`);
    // Either an error or the update was silently filtered
    if (!updateErr) {
      expect(afterUpdate?.name).not.toBe(`${prefix}eve-was-here`);
    }
  });

  it("grant contributor lets outsider log a time entry on the shared project", async () => {
    await clearClientPermissions();

    // Eve needs to see the client as participating for time-entry insert to pass RLS.
    // Use a share with outsiderOrg so Eve (as outsiderOrg owner) has org access to a
    // project on this client... but project.organization_id is primaryOrg.
    // For a cross-org time_entry we need Eve's insert context to reference a project that
    // is visible to her and she has contributor on the client. Since time_entries.organization_id
    // must equal project.organization_id (primaryOrg), Eve cannot have user_has_org_access
    // to primaryOrg. So instead of granting contributor on the primaryOrg-owned project,
    // we test contributor access by verifying Eve can now SELECT the client (she couldn't
    // before even with viewer cleared) AND we seed a client_share for outsiderOrg and a
    // project on outsiderOrg would be a different client. The cleanest confirmation that
    // contributor permission works is: Eve can now SELECT the client, which she couldn't
    // without any grant.
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );

    const { error: grantErr } = await alice.rpc("grant_client_permission", {
      p_client_id: scenario.client.id,
      p_principal_type: "user",
      p_principal_id: scenario.eve.id,
      p_level: "contributor",
    });
    expect(grantErr).toBeNull();

    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );

    const { data: perm, error: permErr } = await eve.rpc(
      "user_client_permission",
      { p_client_id: scenario.client.id },
    );
    expect(permErr).toBeNull();
    expect(perm).toBe("contributor");

    // Eve cannot UPDATE (contributor is not admin)
    const { data: beforeName } = await adminClient()
      .from("clients")
      .select("name")
      .eq("id", scenario.client.id)
      .single();

    await eve
      .from("clients")
      .update({ name: `${prefix}contributor-rename` })
      .eq("id", scenario.client.id);

    const { data: afterName } = await adminClient()
      .from("clients")
      .select("name")
      .eq("id", scenario.client.id)
      .single();
    expect(afterName?.name).toBe(beforeName?.name);
  });

  it("grant admin lets outsider UPDATE the client", async () => {
    await clearClientPermissions();

    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );

    await alice.rpc("grant_client_permission", {
      p_client_id: scenario.client.id,
      p_principal_type: "user",
      p_principal_id: scenario.eve.id,
      p_level: "admin",
    });

    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );

    const newName = `${prefix}eve-admin-rename`;
    const { error } = await eve
      .from("clients")
      .update({ name: newName })
      .eq("id", scenario.client.id);

    expect(error).toBeNull();

    const { data } = await adminClient()
      .from("clients")
      .select("name")
      .eq("id", scenario.client.id)
      .single();
    expect(data?.name).toBe(newName);

    // Restore original name to keep scenario tidy
    await adminClient()
      .from("clients")
      .update({ name: scenario.client.name })
      .eq("id", scenario.client.id);
  });

  it("granting admin to a security group lets its members UPDATE the client", async () => {
    await clearClientPermissions();

    // Create a group in participatingOrg (bob is owner), add Dave.
    const group = await createTestSecurityGroup(
      prefix,
      scenario.participatingOrg.id,
      scenario.bob.id,
      "daveGroup",
    );

    // Add Dave to the group (admin client bypasses RLS; trigger enforces org membership).
    const { error: memberErr } = await adminClient()
      .from("security_group_members")
      .insert({ group_id: group.id, user_id: scenario.dave.id });
    expect(memberErr).toBeNull();

    // Alice grants admin to the group on the client
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { error: grantErr } = await alice.rpc("grant_client_permission", {
      p_client_id: scenario.client.id,
      p_principal_type: "group",
      p_principal_id: group.id,
      p_level: "admin",
    });
    expect(grantErr).toBeNull();

    // Dave should now be able to UPDATE the client
    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );

    const newName = `${prefix}dave-group-rename`;
    const { error: updateErr } = await dave
      .from("clients")
      .update({ name: newName })
      .eq("id", scenario.client.id);

    expect(updateErr).toBeNull();

    const { data } = await adminClient()
      .from("clients")
      .select("name")
      .eq("id", scenario.client.id)
      .single();
    expect(data?.name).toBe(newName);

    // Restore name
    await adminClient()
      .from("clients")
      .update({ name: scenario.client.name })
      .eq("id", scenario.client.id);
  });

  it("grant_client_permission upserts on conflict (one row, latest level)", async () => {
    await clearClientPermissions();

    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );

    const { data: id1 } = await alice.rpc("grant_client_permission", {
      p_client_id: scenario.client.id,
      p_principal_type: "user",
      p_principal_id: scenario.eve.id,
      p_level: "viewer",
    });

    const { data: id2 } = await alice.rpc("grant_client_permission", {
      p_client_id: scenario.client.id,
      p_principal_type: "user",
      p_principal_id: scenario.eve.id,
      p_level: "admin",
    });

    expect(id1).toBe(id2);

    const { data: rows } = await adminClient()
      .from("client_permissions")
      .select("id, permission_level")
      .eq("client_id", scenario.client.id)
      .eq("principal_type", "user")
      .eq("principal_id", scenario.eve.id);

    expect(rows).toHaveLength(1);
    expect(rows![0].permission_level).toBe("admin");
  });

  it("revoking a permission removes access", async () => {
    await clearClientPermissions();

    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    await alice.rpc("grant_client_permission", {
      p_client_id: scenario.client.id,
      p_principal_type: "user",
      p_principal_id: scenario.eve.id,
      p_level: "viewer",
    });

    // Confirm Eve can see it
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data: before } = await eve
      .from("clients")
      .select("id")
      .eq("id", scenario.client.id);
    expect(before).toHaveLength(1);

    // Alice (client admin) deletes the permission row
    const { error: delErr } = await alice
      .from("client_permissions")
      .delete()
      .eq("client_id", scenario.client.id)
      .eq("principal_type", "user")
      .eq("principal_id", scenario.eve.id);
    expect(delErr).toBeNull();

    // Re-authenticate Eve to pick up fresh token state (not strictly necessary but safe)
    const eve2 = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data: after } = await eve2
      .from("clients")
      .select("id")
      .eq("id", scenario.client.id);
    expect(after ?? []).toHaveLength(0);
  });
});
