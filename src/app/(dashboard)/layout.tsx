import Sidebar from "@/components/Sidebar";
import { getOrgContext, getUserOrgs } from "@/lib/org-context";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const ctx = await getOrgContext();
  const orgs = await getUserOrgs();

  return (
    <div className="flex h-full">
      <Sidebar
        orgName={ctx.orgName}
        orgId={ctx.orgId}
        role={ctx.role}
        orgs={orgs}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
