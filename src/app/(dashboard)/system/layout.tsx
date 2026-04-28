import { AlertTriangle } from "lucide-react";
import { requireSystemAdmin, isSystemAdmin } from "@/lib/system-admin";

/**
 * /system route group — sysadmin-only.
 *
 * Authorization is enforced once at the layout level via
 * `requireSystemAdmin()`. Individual pages no longer need the same
 * call (it stays as belt-and-braces but is no longer load-bearing).
 *
 * Per the platform-architect review: the previous pattern repeated
 * `requireSystemAdmin()` on every page, which made forgetting it on
 * a new page a one-line privilege bug. Layout-level enforcement is
 * authorization-by-structure, not authorization-by-discipline.
 */
export default async function SystemLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  await requireSystemAdmin();
  const admin = await isSystemAdmin();

  // Env-misconfiguration banner — keeps the same warning pattern
  // the old /admin layout had, since the same service-role-key
  // dependency exists for /system/users and /system/teams.
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
              System tools are running without {missingEnv.join(" and ")}
            </p>
            <p className="text-content-secondary mt-1">
              Pages that use the service-role Supabase client —
              /system/users and /system/teams — will fail until this
              is set in the deployment environment. /system/errors
              and /system/sample-data still work.
            </p>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
