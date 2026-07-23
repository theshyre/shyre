import type { Metadata } from "next";
import Link from "next/link";
import { FileCheck2, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { getUserTeams, isTeamAdmin } from "@/lib/team-context";
import { buttonPrimaryClass } from "@/lib/form-styles";
import { unwrapEmbed } from "@/lib/supabase/embed";
import { SignoffsTable, type SignoffRow } from "./signoffs-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signoff");
  return { title: t("title") };
}

export default async function SignoffsPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const t = await getTranslations("signoff");

  const teamIds = teams.map((tm) => tm.id);
  const canCreate = teams.some((tm) => isTeamAdmin(tm.role));

  const { data: rows } = await supabase
    .from("signoff_documents")
    .select(
      "id, title, version_label, status, document_type, created_at, customers(name), signoff_signers(id)",
    )
    .in("team_id", teamIds.length ? teamIds : ["00000000-0000-0000-0000-000000000000"])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  const signoffs: SignoffRow[] = (rows ?? []).map((r) => {
    const customer = unwrapEmbed(r.customers as unknown) as { name?: string } | null;
    const signers = Array.isArray(r.signoff_signers) ? r.signoff_signers : [];
    return {
      id: r.id as string,
      title: (r.title as string) || "",
      versionLabel: (r.version_label as string | null) ?? null,
      status: r.status as string,
      customerName: customer?.name ?? null,
      signerCount: signers.length,
      createdAt: r.created_at as string,
    };
  });

  return (
    <div>
      <div className="mb-[24px] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileCheck2 size={24} className="text-accent" aria-hidden="true" />
          <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
        </div>
        {canCreate && (
          <Link href="/signoffs/new" className={buttonPrimaryClass}>
            <Plus size={16} />
            {t("newSignoff")}
          </Link>
        )}
      </div>
      <p className="mb-6 max-w-[680px] text-body text-content-secondary">{t("listIntro")}</p>
      <SignoffsTable rows={signoffs} />
    </div>
  );
}
