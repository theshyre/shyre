import Sidebar from "@/components/Sidebar";
import { getUserContext } from "@/lib/org-context";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const user = await getUserContext();

  return (
    <div className="flex h-full">
      <Sidebar displayName={user.displayName} email={user.userEmail} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
