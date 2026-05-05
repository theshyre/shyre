import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { NextResponse } from "next/server";

// Invite token shape: 32+ url-safe characters generated server-side.
// Reject anything that doesn't look like one before letting it round-
// trip through the login redirect — keeps the URL log surface clean
// and prevents query-string smuggling.
const TOKEN_REGEX = /^[A-Za-z0-9_-]{16,128}$/;

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token || !TOKEN_REGEX.test(token)) {
    return NextResponse.redirect(`${origin}/login?error=missing_token`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Redirect to login with return URL
    return NextResponse.redirect(
      `${origin}/login?next=${encodeURIComponent(`/auth/accept-invite?token=${token}`)}`
    );
  }

  // Look up the invite
  const { data: invite, error: inviteError } = await supabase
    .from("team_invites")
    .select("*")
    .eq("token", token)
    .is("accepted_at", null)
    .single();

  if (inviteError || !invite) {
    return NextResponse.redirect(`${origin}/?error=invalid_invite`);
  }

  // Check if invite is expired
  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.redirect(`${origin}/?error=invite_expired`);
  }

  // Check if email matches
  if (invite.email.toLowerCase() !== user.email?.toLowerCase()) {
    return NextResponse.redirect(`${origin}/?error=email_mismatch`);
  }

  // Check if already a member
  const { data: existing } = await supabase
    .from("team_members")
    .select("id")
    .eq("team_id", invite.team_id)
    .eq("user_id", user.id)
    .single();

  if (existing) {
    // Already a member, just redirect
    return NextResponse.redirect(`${origin}/`);
  }

  // Add user to org
  const { error: memberError } = await supabase
    .from("team_members")
    .insert({
      team_id: invite.team_id,
      user_id: user.id,
      role: invite.role,
    });

  if (memberError) {
    logError(memberError, {
      userId: user.id,
      teamId: invite.team_id,
      url: "/auth/accept-invite",
      action: "acceptInvite",
    });
    return NextResponse.redirect(`${origin}/?error=join_failed`);
  }

  // Mark invite as accepted
  await supabase
    .from("team_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  return NextResponse.redirect(`${origin}/`);
}
