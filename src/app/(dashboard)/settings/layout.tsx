/**
 * /admin layout — passthrough.
 *
 * After Tier 2 of the admin-IA cleanup, all sysadmin sub-routes
 * moved to /system/*, taking the env-misconfiguration banner with
 * them. The /admin URL itself becomes /settings in Tier 3 (with
 * the appropriate redirect). This passthrough is a temporary
 * landing for /admin until that move lands.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return <>{children}</>;
}
