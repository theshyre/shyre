import { createTestUser, TestUser } from "./users";
import { createTestTeam, addTeamMember, TestTeam } from "./teams";
import { createTestCustomer, createTestProject, TestClient } from "./customers";

export interface TwoTeamSharingScenario {
  prefix: string;
  primaryTeam: TestTeam;
  participatingTeam: TestTeam;
  outsiderTeam: TestTeam;
  alice: TestUser;
  bob: TestUser;
  carol: TestUser;
  dave: TestUser;
  eve: TestUser;
  client: TestClient;
  project: { id: string; name: string };
}

/**
 * Reusable scenario with 3 teams, 5 users, and 1 shared client.
 *
 * - Alice: owner of primaryTeam
 * - Bob: owner of participatingTeam
 * - Carol: member of primaryTeam
 * - Dave: member of participatingTeam
 * - Eve: owner of outsiderTeam (no relationship)
 * - client: owned by primaryTeam
 * - project: under client
 *
 * Sharing is NOT set up — the test does that to exercise the sharing flow.
 */
export async function twoTeamSharingScenario(
  prefix: string,
): Promise<TwoTeamSharingScenario> {
  const alice = await createTestUser(prefix, "alice");
  const bob = await createTestUser(prefix, "bob");
  const carol = await createTestUser(prefix, "carol");
  const dave = await createTestUser(prefix, "dave");
  const eve = await createTestUser(prefix, "eve");

  const primaryTeam = await createTestTeam(prefix, alice.id, "primary");
  const participatingTeam = await createTestTeam(prefix, bob.id, "participating");
  const outsiderTeam = await createTestTeam(prefix, eve.id, "outsider");

  await addTeamMember(primaryTeam.id, carol.id, "member");
  await addTeamMember(participatingTeam.id, dave.id, "member");

  const client = await createTestCustomer(prefix, primaryTeam.id, alice.id);
  const project = await createTestProject(
    prefix,
    primaryTeam.id,
    client.id,
    alice.id,
  );

  return {
    prefix,
    primaryTeam,
    participatingTeam,
    outsiderTeam,
    alice,
    bob,
    carol,
    dave,
    eve,
    client,
    project,
  };
}
