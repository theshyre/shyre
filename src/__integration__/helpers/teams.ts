import { adminClient } from "./admin";
import { assertTestPrefix } from "./prefix";

export interface TestTeam {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
}

export async function createTestTeam(
  prefix: string,
  ownerId: string,
  label = "team",
  options?: { businessId?: string },
): Promise<TestTeam> {
  assertTestPrefix(prefix, "prefix");
  const name = `${prefix}${label}`;
  const slug = `${prefix}${label}-${Date.now().toString(36)}`;

  const admin = adminClient();

  // teams.business_id is NOT NULL since SAL-007. Either reuse a
  // caller-supplied business (for multi-team-one-business scenarios)
  // or seed a fresh shell business.
  let businessId = options?.businessId ?? null;
  if (!businessId) {
    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .insert({ name })
      .select("id")
      .single();
    if (bizErr || !biz) {
      throw new Error(`Failed to create test business: ${bizErr?.message}`);
    }
    businessId = biz.id as string;
  }

  const { data: team, error: teamErr } = await admin
    .from("teams")
    .insert({ name, slug, is_personal: false, business_id: businessId })
    .select("id")
    .single();

  if (teamErr || !team) {
    throw new Error(`Failed to create test team: ${teamErr?.message}`);
  }

  const { error: memberErr } = await admin
    .from("team_members")
    .insert({
      team_id: team.id,
      user_id: ownerId,
      role: "owner",
    });

  if (memberErr) {
    throw new Error(`Failed to add owner membership: ${memberErr.message}`);
  }

  const { error: settingsErr } = await admin
    .from("team_settings")
    .insert({ team_id: team.id });

  if (settingsErr) {
    throw new Error(`Failed to create team settings: ${settingsErr.message}`);
  }

  return { id: team.id, name, slug, ownerId };
}

export async function addTeamMember(
  teamId: string,
  userId: string,
  role: "owner" | "admin" | "member",
  options?: { joinedAt?: Date },
): Promise<void> {
  const row: Record<string, unknown> = {
    team_id: teamId,
    user_id: userId,
    role,
  };
  if (options?.joinedAt) row.joined_at = options.joinedAt.toISOString();
  const { error } = await adminClient().from("team_members").insert(row);
  if (error) throw new Error(error.message);
}

/**
 * Update an existing membership's joined_at. Used by tests that need to
 * exercise the pre-membership defense-in-depth filter — seeding old
 * entries and then bumping joined_at forward, or vice versa.
 */
export async function setMembershipJoinedAt(
  teamId: string,
  userId: string,
  joinedAt: Date,
): Promise<void> {
  const { error } = await adminClient()
    .from("team_members")
    .update({ joined_at: joinedAt.toISOString() })
    .eq("team_id", teamId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function removeTeamMember(
  teamId: string,
  userId: string,
): Promise<void> {
  const { error } = await adminClient()
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
