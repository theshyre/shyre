import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { validateTeamAccess } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { TeamSection } from "../team-section";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: team } = await supabase
    .from("teams")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  const t = await getTranslations("common");
  return {
    title: `${t("teamHub.members.title")} — ${(team?.name as string) ?? ""}`,
  };
}

/**
 * /teams/[id]/members — members + open invites.
 *
 * Owner/admin can invite, change roles, transfer ownership; member
 * sees the roster (read-only). Same TeamSection component the legacy
 * combined page rendered, just lifted to its own route.
 */
export default async function TeamMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const { userId, role } = await validateTeamAccess(id);

  const { data: org } = await supabase
    .from("teams")
    .select("name")
    .eq("id", id)
    .single();
  if (!org) notFound();

  // Two-step fetch: team_members has no FK to user_profiles (both go
  // through auth.users), so PostgREST can't embed the profile join.
  // Same logic as the legacy combined page.
  const { data: rawMembers } = await supabase
    .from("team_members")
    .select("id, user_id, role, joined_at")
    .eq("team_id", id);
  const memberUserIds = (rawMembers ?? []).map((m) => m.user_id as string);
  const { data: profileRows } =
    memberUserIds.length > 0
      ? await supabase
          .from("user_profiles")
          .select("user_id, display_name, is_shell")
          .in("user_id", memberUserIds)
      : { data: [] };
  const displayNameByUserId = new Map<string, string | null>(
    (profileRows ?? []).map((p) => [
      p.user_id as string,
      (p.display_name as string | null) ?? null,
    ]),
  );
  const isShellByUserId = new Map<string, boolean>(
    (profileRows ?? []).map((p) => [
      p.user_id as string,
      ((p as { is_shell?: boolean | null }).is_shell ?? false) === true,
    ]),
  );
  const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, member: 2 };
  const members = (rawMembers ?? [])
    .map((m) => ({
      ...m,
      is_shell: isShellByUserId.get(m.user_id as string) ?? false,
      user_profiles: {
        display_name: displayNameByUserId.get(m.user_id as string) ?? null,
      },
    }))
    .sort((a, b) => {
      if (a.is_shell !== b.is_shell) return a.is_shell ? 1 : -1;
      const rankDiff = (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99);
      if (rankDiff !== 0) return rankDiff;
      return (a.joined_at ?? "").localeCompare(b.joined_at ?? "");
    });

  // The `token` column is readable here under the existing
  // `team_invites_manage` RLS policy (owner/admin only, same gate as
  // the invite/revoke actions) — it powers the "Copy invite link"
  // fallback on each pending-invite row so an admin can always hand
  // the accept URL to the invitee, whether or not email delivery is
  // configured for this team (see teams/[id]/team-actions.ts).
  const { data: rawInvites } = await supabase
    .from("team_invites")
    .select("id, email, role, created_at, expires_at, token")
    .eq("team_id", id)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  // Same base URL the invite email itself uses when building the
  // accept link (see tryDeliverInviteEmail in team-actions.ts) — kept
  // consistent so the copied link and the emailed link are identical.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? null;
  const invites = (rawInvites ?? []).map((invite) => ({
    id: invite.id as string,
    email: invite.email as string,
    role: invite.role as string,
    created_at: invite.created_at as string,
    expires_at: invite.expires_at as string,
    acceptUrl: baseUrl
      ? `${baseUrl}/auth/accept-invite?token=${invite.token as string}`
      : null,
  }));

  // Drives the "email isn't set up" hint on the invite form — mirrors
  // the same apiKeySaved + fromAddressSet gate the /email setup
  // checklist and tryDeliverInviteEmail both use to decide whether a
  // send is even attempted.
  const { data: emailConfig } = await supabase
    .from("team_email_config")
    .select("api_key_encrypted, from_email")
    .eq("team_id", id)
    .maybeSingle();
  const hasEmailConfigured = Boolean(
    emailConfig?.api_key_encrypted && emailConfig?.from_email,
  );

  const t = await getTranslations("common");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">
          {t("teamHub.members.title")}
        </h1>
      </div>
      <p className="text-body text-content-secondary max-w-2xl">
        {t("teamHub.members.description")}
      </p>

      <TeamSection
        teamName={org.name as string}
        teamId={id}
        isPersonalOrg={false}
        currentRole={role}
        currentUserId={userId}
        members={members}
        invites={invites}
        hasEmailConfigured={hasEmailConfigured}
      />
    </div>
  );
}
