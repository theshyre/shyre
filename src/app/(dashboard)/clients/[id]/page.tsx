import { redirect } from "next/navigation";

/** Back-compat redirect — the old /clients/[id] route moved to /customers/[id]. */
export default async function ClientDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;
  redirect(`/customers/${id}`);
}
