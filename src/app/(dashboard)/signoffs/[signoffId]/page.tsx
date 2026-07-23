import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileCheck2, Pencil } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { getUserTeams, isTeamAdmin } from "@/lib/team-context";
import { MarkdownView } from "@/components/MarkdownView";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { unwrapEmbed } from "@/lib/supabase/embed";
import {
  isSignoffDeletable,
  isSignoffEditable,
  signoffSendReadiness,
} from "@/lib/sign/readiness";
import { SignoffStatusBadge } from "../signoff-status-badge";
import { SignoffDeleteButton } from "../signoff-delete-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signoff");
  return { title: t("title") };
}

interface Signer {
  id: string;
  name: string;
  email: string;
  role_label: string | null;
  org_label: string | null;
  sort_order: number;
}
interface Acceptance {
  id: string;
  signer_id: string | null;
  signer_name: string;
  signer_title: string | null;
  decision: string;
  signature_meaning: string | null;
  content_sha256: string;
  signed_at: string;
}

export default async function SignoffDetailPage({
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
      "id, team_id, title, version_label, status, body_markdown, sign_theme, created_at, customers(name), signoff_signers(id, name, email, role_label, org_label, sort_order), signoff_acceptances(id, signer_id, signer_name, signer_title, decision, signature_meaning, content_sha256, signed_at)",
    )
    .eq("id", signoffId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!doc) notFound();

  const teamId = doc.team_id as string;
  const canManage = teams.some((tm) => tm.id === teamId && isTeamAdmin(tm.role));
  const customer = unwrapEmbed(doc.customers as unknown) as { name?: string } | null;
  const signers = (Array.isArray(doc.signoff_signers) ? doc.signoff_signers : [])
    .slice()
    .sort((a, b) => (a as Signer).sort_order - (b as Signer).sort_order) as Signer[];
  const acceptances = (Array.isArray(doc.signoff_acceptances)
    ? doc.signoff_acceptances
    : []) as Acceptance[];
  const status = doc.status as string;
  const readiness = signoffSendReadiness({
    title: doc.title as string,
    bodyMarkdown: doc.body_markdown as string,
    signerCount: signers.length,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileCheck2 size={24} className="text-accent" aria-hidden="true" />
          <div>
            <h1 className="text-page-title font-bold text-content">
              {(doc.title as string) || t("untitled")}
            </h1>
            <div className="mt-1 flex items-center gap-2 text-body text-content-secondary">
              {doc.version_label && <span>{doc.version_label as string}</span>}
              {customer?.name && <span>· {customer.name}</span>}
              <SignoffStatusBadge status={status} />
            </div>
          </div>
        </div>
        {canManage && isSignoffEditable(status) && (
          <div className="flex items-center gap-2">
            <Link href={`/signoffs/${signoffId}/edit`} className={buttonSecondaryClass}>
              <Pencil size={15} />
              {t("edit")}
            </Link>
            {isSignoffDeletable(status) && (
              <SignoffDeleteButton documentId={signoffId} />
            )}
          </div>
        )}
      </div>

      {canManage && status === "draft" && readiness.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3">
          <p className="text-body-lg font-medium text-warning-text">{t("readiness.heading")}</p>
          <ul className="mt-1 list-disc pl-5 text-body text-warning-text">
            {readiness.map((k) => (
              <li key={k}>{t(`readiness.${k}`)}</li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby="signoff-signers-heading">
        <h2 id="signoff-signers-heading" className="text-title font-semibold text-content mb-2">
          {t("signersHeading")}
        </h2>
        {signers.length === 0 ? (
          <p className="text-body text-content-muted">{t("noSigners")}</p>
        ) : (
          <ul className="space-y-1.5">
            {signers.map((s) => {
              const acc = acceptances.find((a) => a.signer_id === s.id);
              return (
                <li key={s.id} className="flex items-center gap-2 text-body">
                  <span className="font-medium text-content">{s.name}</span>
                  <span className="text-content-muted">{s.email}</span>
                  {s.role_label && <span className="text-content-secondary">· {s.role_label}</span>}
                  {s.org_label && <span className="text-content-muted">· {s.org_label}</span>}
                  {acc && (
                    <span className="ml-1 text-label text-success-text">
                      {t(`signedAs.${acc.decision}`)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {acceptances.length > 0 && (
        <section aria-labelledby="signoff-records-heading">
          <h2 id="signoff-records-heading" className="text-title font-semibold text-content mb-2">
            {t("recordsHeading")}
          </h2>
          <ul className="space-y-2">
            {acceptances.map((a) => (
              <li key={a.id} className="rounded-lg border border-edge px-3 py-2 text-body">
                <div className="font-medium text-content">
                  {a.signer_name}
                  {a.signer_title && (
                    <span className="text-content-muted"> · {a.signer_title}</span>
                  )}
                </div>
                <div className="mt-0.5 text-label text-content-muted">
                  {t(`signedAs.${a.decision}`)}
                  {a.signature_meaning && ` · ${t(`meaning.${a.signature_meaning}`)}`}
                  {" · "}
                  <span className="font-mono">{a.content_sha256.slice(0, 16)}…</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="signoff-doc-heading">
        <h2 id="signoff-doc-heading" className="text-title font-semibold text-content mb-2">
          {t("documentHeading")}
        </h2>
        <div className="rounded-lg border border-edge bg-surface-raised px-5 py-4">
          <MarkdownView content={doc.body_markdown as string} />
        </div>
      </section>
    </div>
  );
}
