import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
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
    .from("organization_invites")
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
    .from("organization_members")
    .select("id")
    .eq("organization_id", invite.organization_id)
    .eq("user_id", user.id)
    .single();

  if (existing) {
    // Already a member, just redirect
    return NextResponse.redirect(`${origin}/`);
  }

  // Add user to org
  const { error: memberError } = await supabase
    .from("organization_members")
    .insert({
      organization_id: invite.organization_id,
      user_id: user.id,
      role: invite.role,
    });

  if (memberError) {
    return NextResponse.redirect(`${origin}/?error=join_failed`);
  }

  // Mark invite as accepted
  await supabase
    .from("organization_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  return NextResponse.redirect(`${origin}/`);
}
