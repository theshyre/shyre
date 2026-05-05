import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Same-origin path or "/" if the input is anything else. Rejects
 *  protocol-relative (`//evil.com`), backslash-prefixed (`/\evil`),
 *  and absolute URLs — all common open-redirect bypass shapes. */
function safeNext(next: string | null): string {
  if (!next) return "/";
  // Must start with "/" and the second char must NOT be "/" or "\".
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  if (next.startsWith("/\\")) return "/";
  return next;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
