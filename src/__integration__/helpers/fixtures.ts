import { createTestUser, TestUser } from "./users";
import { createTestOrg, addOrgMember, TestOrg } from "./orgs";
import { createTestClient, createTestProject, TestClient } from "./clients";

export interface TwoOrgSharingScenario {
  prefix: string;
  primaryOrg: TestOrg;
  participatingOrg: TestOrg;
  outsiderOrg: TestOrg;
  alice: TestUser;
  bob: TestUser;
  carol: TestUser;
  dave: TestUser;
  eve: TestUser;
  client: TestClient;
  project: { id: string; name: string };
}

/**
 * Reusable scenario with 3 orgs, 5 users, and 1 shared client.
 *
 * - Alice: owner of primaryOrg
 * - Bob: owner of participatingOrg
 * - Carol: member of primaryOrg
 * - Dave: member of participatingOrg
 * - Eve: owner of outsiderOrg (no relationship)
 * - client: owned by primaryOrg
 * - project: under client
 *
 * Sharing is NOT set up — the test does that to exercise the sharing flow.
 */
export async function twoOrgSharingScenario(
  prefix: string,
): Promise<TwoOrgSharingScenario> {
  const alice = await createTestUser(prefix, "alice");
  const bob = await createTestUser(prefix, "bob");
  const carol = await createTestUser(prefix, "carol");
  const dave = await createTestUser(prefix, "dave");
  const eve = await createTestUser(prefix, "eve");

  const primaryOrg = await createTestOrg(prefix, alice.id, "primary");
  const participatingOrg = await createTestOrg(prefix, bob.id, "participating");
  const outsiderOrg = await createTestOrg(prefix, eve.id, "outsider");

  await addOrgMember(primaryOrg.id, carol.id, "member");
  await addOrgMember(participatingOrg.id, dave.id, "member");

  const client = await createTestClient(prefix, primaryOrg.id, alice.id);
  const project = await createTestProject(
    prefix,
    primaryOrg.id,
    client.id,
    alice.id,
  );

  return {
    prefix,
    primaryOrg,
    participatingOrg,
    outsiderOrg,
    alice,
    bob,
    carol,
    dave,
    eve,
    client,
    project,
  };
}
