import { requireSystemAdmin } from "@/lib/system-admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  await requireSystemAdmin();

  return <>{children}</>;
}
