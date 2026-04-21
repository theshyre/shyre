import { createClient } from "@/lib/supabase/server";
import { validateTeamAccess } from "@/lib/team-context";
import {
  PeopleSection,
  type PersonRow,
  type LinkableUser,
} from "./people-section";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BusinessPeoplePage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { id: teamId } = await params;
  const supabase = await createClient();
  const { role } = await validateTeamAccess(teamId);
  const canEdit = role === "owner" || role === "admin";

  // Resolve team → business.
  const { data: teamRow } = await supabase
    .from("teams")
    .select("business_id")
    .eq("id", teamId)
    .maybeSingle();
  const businessId = (teamRow?.business_id as string | null) ?? null;

  if (!businessId) {
    return (
      <p className="text-sm text-content-muted italic p-4">
        This team is not linked to a business.
      </p>
    );
  }

  // All teams owned by this business; team_members of any of those teams
  // are eligible candidates for linking a person record to a Shyre user.
  const { data: businessTeams } = await supabase
    .from("teams")
    .select("id")
    .eq("business_id", businessId);
  const teamIds = (businessTeams ?? []).map((t) => t.id as string);

  const [{ data: rawPeople }, linkableUsers] = await Promise.all([
    supabase
      .from("business_people")
      .select(
        "id, user_id, legal_name, preferred_name, work_email, work_phone, employment_type, title, department, employee_number, started_on, ended_on, compensation_type, compensation_amount_cents, compensation_currency, compensation_schedule, address_line1, address_line2, city, state, postal_code, country, reports_to_person_id, notes",
      )
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .order("legal_name", { ascending: true }),
    teamIds.length > 0 ? fetchLinkableUsers(supabase, teamIds) : Promise.resolve([] as LinkableUser[]),
  ]);

  const people = (rawPeople ?? []) as PersonRow[];

  return (
    <PeopleSection
      businessId={businessId}
      people={people}
      linkableUsers={linkableUsers}
      canEdit={canEdit}
    />
  );
}

async function fetchLinkableUsers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teamIds: string[],
): Promise<LinkableUser[]> {
  const { data: members } = await supabase
    .from("team_members")
    .select("user_id")
    .in("team_id", teamIds);
  const userIds = Array.from(
    new Set((members ?? []).map((m) => m.user_id as string)),
  );
  if (userIds.length === 0) return [];

  const [{ data: profiles }, { data: authUsers }] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", userIds),
    // auth.users.email is only exposed via the user's own session, so
    // we can't fetch other users' emails here without a helper view.
    // For v1, pass email=null for other users; the UI falls back to
    // the display name or the user_id prefix in the select options.
    Promise.resolve({ data: [] as { id: string; email: string | null }[] }),
  ]);

  const emailById = new Map<string, string | null>(
    (authUsers ?? []).map((u) => [u.id as string, u.email ?? null]),
  );
  const profileById = new Map<string, string | null>(
    (profiles ?? []).map((p) => [
      p.user_id as string,
      (p.display_name as string | null) ?? null,
    ]),
  );

  return userIds
    .map((id) => ({
      user_id: id,
      display_name: profileById.get(id) ?? null,
      email: emailById.get(id) ?? null,
    }))
    .sort((a, b) =>
      (a.display_name ?? "").localeCompare(b.display_name ?? ""),
    );
}
