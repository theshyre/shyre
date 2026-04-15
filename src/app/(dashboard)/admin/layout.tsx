import { AlertTriangle } from "lucide-react";
import { isSystemAdmin } from "@/lib/system-admin";

/**
 * Admin layout: renders a shared env-misconfiguration banner when the
 * current user is a system admin AND a required env var is missing.
 *
 * Note: this layout no longer gates the whole /admin tree with
 * requireSystemAdmin — the hub page at /admin is visible to every user
 * (Business, Teams, Categories, etc. all have their own RLS / access
 * rules). System-admin-only sub-routes (/admin/errors, /admin/users,
 * /admin/teams, /admin/sample-data, /admin/test-error) each call
 * requireSystemAdmin() themselves.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const admin = await isSystemAdmin();

  const missingEnv: string[] = [];
  if (admin) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
      missingEnv.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL)
      missingEnv.push("NEXT_PUBLIC_SUPABASE_URL");
  }

  return (
    <>
      {missingEnv.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-error/40 bg-error-soft px-4 py-3 text-body text-error">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              Admin tools are running without {missingEnv.join(" and ")}
            </p>
            <p className="text-content-secondary mt-1">
              Pages that use the service-role Supabase client — /admin/users,
              /admin/teams — will fail until this is set in the deployment
              environment. /admin/errors and /admin/sample-data still work.
            </p>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
