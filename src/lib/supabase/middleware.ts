import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session - important for Server Components
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users to login. Exemptions: the login page,
  // the Supabase auth callbacks, /sign — the public proposal sign-off
  // surface (SAL-036) — and the Resend delivery webhook, which is called by
  // Resend with NO session and authenticates itself via an HMAC signature
  // (SAL-044). Without this exemption the webhook 307-redirects to /login, so
  // Resend never gets a 2xx and eventually disables the endpoint.
  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    // Exact segment match — `startsWith("/sign")` would silently exempt any
    // future /sign* route (/signup, /signals, …) from auth. SAL-036/037.
    request.nextUrl.pathname !== "/sign" &&
    !request.nextUrl.pathname.startsWith("/sign/") &&
    // Exact path — the webhook verifies its own HMAC; no other /api route is
    // public (the rest are session-gated user exports/imports).
    request.nextUrl.pathname !== "/api/messaging/webhook/resend"
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
