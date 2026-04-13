import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { FolderKanban } from "lucide-react";
import { ClientEditForm } from "./client-edit-form";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const t = await getTranslations("clients");

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (!client) notFound();

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("client_id", id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <ClientEditForm client={client} />

      <div className="mt-8">
        <div className="flex items-center gap-3">
          <FolderKanban size={20} className="text-accent" />
          <h2 className="text-lg font-semibold text-content">
            {t("projects.title")}
          </h2>
        </div>
        {projects && projects.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {projects.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-edge bg-surface-raised px-4 py-3 hover:bg-hover transition-colors"
              >
                <div>
                  <span className="font-medium text-content">{p.name}</span>
                  {p.status !== "active" && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-surface-inset px-2 py-0.5 text-xs text-content-muted">
                      {p.status}
                    </span>
                  )}
                </div>
                <span className="text-sm text-content-secondary font-mono">
                  {p.hourly_rate
                    ? `$${Number(p.hourly_rate).toFixed(2)}/hr`
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-content-muted">
            {t("projects.noProjects")}
          </p>
        )}
      </div>
    </div>
  );
}
