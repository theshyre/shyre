import { requireSystemAdmin } from "@/lib/system-admin";
import { AlertTriangle } from "lucide-react";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  await requireSystemAdmin();

  // Surface missing server env vars at the top of every admin page so a
  // misconfigured deploy is obvious instead of crashing individual pages
  // with generic "Something went wrong" screens.
  const missingEnv: string[] = [];
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missingEnv.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missingEnv.push("NEXT_PUBLIC_SUPABASE_URL");

  return (
    <>
      {missingEnv.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-error/40 bg-error-soft px-4 py-3 text-sm text-error">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              Admin tools are running without {missingEnv.join(" and ")}
            </p>
            <p className="text-content-secondary mt-1">
              Pages that use the service-role Supabase client — /admin/users,
              /admin/teams — will fail until this is set in the
              deployment environment. /admin/errors and /admin/sample-data will
              still work. The error logger falls back to a SECURITY DEFINER RPC
              (log_error_from_user) so new errors are still captured.
            </p>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
