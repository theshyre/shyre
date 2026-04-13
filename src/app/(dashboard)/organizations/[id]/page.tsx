import { createClient } from "@/lib/supabase/server";
import { validateOrgAccess, getUserContext } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  Users,
  FolderKanban,
  ArrowRight,
} from "lucide-react";
import { OrgSettingsForm } from "./org-settings-form";
import { TeamSection } from "../../../(dashboard)/settings/team-section";

export default async function OrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const { userId, role } = await validateOrgAccess(id);

  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", id)
    .single();

  if (!org) notFound();

  const { data: orgSettings } = await supabase
    .from("organization_settings")
    .select("*")
    .eq("organization_id", id)
    .single();

  const { data: members } = await supabase
    .from("organization_members")
    .select("id, user_id, role, joined_at, user_profiles(display_name)")
    .eq("organization_id", id)
    .order("joined_at");

  const { data: invites } = await supabase
    .from("organization_invites")
    .select("id, email, role, created_at, expires_at")
    .eq("organization_id", id)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  // Org's clients
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, email, default_rate")
    .eq("organization_id", id)
    .eq("archived", false)
    .order("name");

  // Org's projects
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, status, hourly_rate, client_id, clients(name)")
    .eq("organization_id", id)
    .neq("status", "archived")
    .order("created_at", { ascending: false });

  const tc = await getTranslations("common");
  const tp = await getTranslations("projects");

  return (
    <div>
      <div className="flex items-center gap-3">
        <Building2 size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{org.name}</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2.5 py-0.5 text-xs font-medium text-content-muted">
          {role}
        </span>
      </div>

      {/* Clients */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
              {tc("nav.clients")}
            </h2>
          </div>
          <Link
            href={`/clients?org=${id}`}
            className="flex items-center gap-1 text-xs text-accent hover:underline"
          >
            View all <ArrowRight size={12} />
          </Link>
        </div>
        {clients && clients.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {clients.slice(0, 6).map((client) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="rounded-lg border border-edge bg-surface-raised px-3 py-2 text-sm hover:bg-hover transition-colors"
              >
                <span className="font-medium text-content">{client.name}</span>
                {client.default_rate && (
                  <span className="ml-2 text-xs text-content-muted font-mono">
                    ${Number(client.default_rate).toFixed(0)}/hr
                  </span>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-content-muted">No clients yet.</p>
        )}
      </div>

      {/* Projects */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderKanban size={18} className="text-accent" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
              {tc("nav.projects")}
            </h2>
          </div>
          <Link
            href={`/projects?org=${id}`}
            className="flex items-center gap-1 text-xs text-accent hover:underline"
          >
            View all <ArrowRight size={12} />
          </Link>
        </div>
        {projects && projects.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {projects.slice(0, 6).map((project) => {
              const clientName =
                project.clients &&
                typeof project.clients === "object" &&
                "name" in project.clients
                  ? (project.clients as { name: string }).name
                  : null;
              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="rounded-lg border border-edge bg-surface-raised px-3 py-2 text-sm hover:bg-hover transition-colors"
                >
                  <span className="font-medium text-content">
                    {project.name}
                  </span>
                  <span className="ml-2 text-xs text-content-muted">
                    {clientName ?? tp("internal")}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-sm text-content-muted">No projects yet.</p>
        )}
      </div>

      <OrgSettingsForm
        orgSettings={orgSettings}
        orgId={id}
        role={role}
      />

      <TeamSection
        orgName={org.name}
        orgId={id}
        isPersonalOrg={false}
        currentRole={role}
        currentUserId={userId}
        members={members ?? []}
        invites={invites ?? []}
      />
    </div>
  );
}
