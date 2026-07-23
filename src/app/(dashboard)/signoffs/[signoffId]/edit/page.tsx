import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FileCheck2 } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { getUserTeams, isTeamAdmin } from "@/lib/team-context";
import { isSignoffEditable } from "@/lib/sign/readiness";
import {
  SignoffForm,
  type CustomerOption,
  type SignoffFormInitial,
} from "../../signoff-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signoff");
  return { title: t("editPageTitle") };
}

interface SignerRow {
  name: string;
  email: string;
  role_label: string | null;
  org_label: string | null;
  sort_order: number;
}

export default async function EditSignoffPage({
  params,
}: {
  params: Promise<{ signoffId: string }>;
}): Promise<React.JSX.Element> {
  const { signoffId } = await params;
  const supabase = await createClient();
  const teams = await getUserTeams();
  const t = await getTranslations("signoff");

  const { data: doc } = await supabase
    .from("signoff_documents")
    .select(
      "id, team_id, customer_id, title, version_label, body_markdown, external_ref, signing_mode, sign_theme, status, signoff_signers(name, email, role_label, org_label, sort_order)",
    )
    .eq("id", signoffId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!doc) notFound();
  const teamId = doc.team_id as string;
  const canManage = teams.some((tm) => tm.id === teamId && isTeamAdmin(tm.role));
  if (!canManage || !isSignoffEditable(doc.status as string)) {
    redirect(`/signoffs/${signoffId}`);
  }

  const adminTeams = teams.filter((tm) => isTeamAdmin(tm.role));
  const { data: customerRows } = await supabase
    .from("customers")
    .select("id, name, team_id")
    .eq("archived", false)
    .in("team_id", adminTeams.map((tm) => tm.id))
    .order("name");
  const customers: CustomerOption[] = (customerRows ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    team_id: c.team_id as string,
  }));

  const signers = (Array.isArray(doc.signoff_signers) ? doc.signoff_signers : [])
    .slice()
    .sort((a, b) => (a as SignerRow).sort_order - (b as SignerRow).sort_order)
    .map((s) => ({
      name: (s as SignerRow).name,
      email: (s as SignerRow).email,
      roleLabel: (s as SignerRow).role_label ?? "",
      orgLabel: (s as SignerRow).org_label ?? "",
    }));

  const initial: SignoffFormInitial = {
    documentId: signoffId,
    teamId,
    customerId: (doc.customer_id as string | null) ?? null,
    title: (doc.title as string) || "",
    versionLabel: (doc.version_label as string | null) ?? "",
    bodyMarkdown: (doc.body_markdown as string) || "",
    externalRef: (doc.external_ref as string | null) ?? "",
    signingMode: (doc.signing_mode as string) || "all",
    signTheme: (doc.sign_theme as string) || "light",
    signers,
  };

  return (
    <div>
      <div className="mb-[24px] flex items-center gap-3">
        <FileCheck2 size={24} className="text-accent" aria-hidden="true" />
        <h1 className="text-page-title font-bold text-content">{t("editPageTitle")}</h1>
      </div>
      <SignoffForm
        teams={adminTeams.map((tm) => ({ id: tm.id, name: tm.name }))}
        customers={customers}
        initial={initial}
      />
    </div>
  );
}
