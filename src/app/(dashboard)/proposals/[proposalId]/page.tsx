import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Pencil, Eye, CheckCircle2, XCircle, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { formatCurrency } from "@/lib/invoice-utils";
import { roundMoney } from "@/lib/proposals/line-items";
import type { ProposalPDFItem } from "@/components/ProposalPDF";
import { CustomerChip } from "@/components/CustomerChip";
import { ProposalStatusBadge } from "../proposal-status-badge";
import { DeleteProposalButton } from "../delete-proposal-button";
import { SendProposalButton } from "../send-proposal-button";
import { CounterSignButton } from "../counter-sign-button";
import { ConvertProposalButton } from "../convert-proposal-button";
import { CreateInvoiceButton } from "../create-invoice-button";
import { NewVersionButton } from "../new-version-button";
import { ProposalPdfButton, type ProposalPdfBundle } from "./proposal-pdf-button";
import { isProposalEditable, type DepositType } from "../allow-lists";
import { proposalSendReadiness } from "@/lib/proposals/readiness";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("proposals");
  return { title: t("title") };
}

interface LineItemRow {
  id: string;
  parent_line_item_id: string | null;
  sort_order: number;
  title: string;
  description: string | null;
  why_it_matters: string | null;
  out_of_scope: string | null;
  definition_of_done: string | null;
  fixed_price: number | string;
  is_capped: boolean;
  converted_project_id: string | null;
  invoiced_at: string | null;
}

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}): Promise<React.JSX.Element> {
  const { proposalId } = await params;
  const supabase = await createClient();
  const t = await getTranslations("proposals.detail");
  const tActivity = await getTranslations("proposals.activity");

  const { data: proposal } = await supabase
    .from("proposals")
    .select(
      "*, customers(id, name, email, address, show_country_on_invoice, accent_color, logo_url), customer_contacts(id, name, email)",
    )
    .eq("id", proposalId)
    .single();
  if (!proposal) notFound();

  const { data: itemRows } = await supabase
    .from("proposal_line_items")
    .select(
      "id, parent_line_item_id, sort_order, title, description, why_it_matters, out_of_scope, definition_of_done, fixed_price, is_capped, converted_project_id, invoiced_at",
    )
    .eq("proposal_id", proposalId)
    .order("sort_order");

  const { data: branding } = await supabase
    .from("team_settings")
    .select(
      "business_name, business_email, business_address, business_phone, wordmark_primary, wordmark_secondary, brand_color, logo_url, show_country_on_invoice",
    )
    .eq("team_id", proposal.team_id as string)
    .single();

  // Sign-off state (owner/admin-visible via RLS): the latest link, the
  // decision record, and the forward event log.
  const { data: tokenRows } = await supabase
    .from("proposal_access_tokens")
    .select("signer_email, expires_at, first_viewed_at, consumed_at")
    .eq("proposal_id", proposalId)
    .order("created_at", { ascending: false })
    .limit(1);
  const signToken = tokenRows?.[0] ?? null;

  const { data: acceptanceRows } = await supabase
    .from("proposal_acceptances")
    .select(
      "signer_id, decision, signer_name, signer_title, signer_email, signature_typed, selected_line_item_ids, accepted_total, content_sha256, ip_address, occurred_at, provider_signed_at",
    )
    .eq("proposal_id", proposalId)
    .order("occurred_at", { ascending: false });
  const acceptance = acceptanceRows?.[0] ?? null;

  // Multi-signer roster + per-signer status ("2 of 3 signed").
  const { data: signerRows } = await supabase
    .from("proposal_signers")
    .select("id, sort_order, customer_contacts(name, email, role_label)")
    .eq("proposal_id", proposalId)
    .order("sort_order");
  const acceptanceBySigner = new Map(
    (acceptanceRows ?? [])
      .filter((a) => a.signer_id != null)
      .map((a) => [a.signer_id as string, a.decision as string]),
  );
  const roster = (signerRows ?? []).map((row) => {
    const c = (
      Array.isArray(row.customer_contacts)
        ? row.customer_contacts[0]
        : row.customer_contacts
    ) as { name: string; email: string; role_label: string | null } | null;
    return {
      id: row.id as string,
      name: c?.name ?? "—",
      roleLabel: c?.role_label ?? null,
      decision: acceptanceBySigner.get(row.id as string) ?? null,
    };
  });
  const signedCount = roster.filter((r) => r.decision === "accepted").length;

  const { data: eventRows } = await supabase
    .from("proposal_events")
    .select("id, event_type, actor_label, occurred_at")
    .eq("proposal_id", proposalId)
    .order("occurred_at", { ascending: true });
  const events = eventRows ?? [];

  // Version chain: the proposal this one replaced, and the one that replaced
  // it (a superseded doc always points forward to its successor).
  const supersedesId = (proposal.supersedes_proposal_id as string | null) ?? null;
  const { data: supersedesRow } = supersedesId
    ? await supabase
        .from("proposals")
        .select("id, proposal_number")
        .eq("id", supersedesId)
        .single()
    : { data: null };
  const { data: supersededByRows } = await supabase
    .from("proposals")
    .select("id, proposal_number")
    .eq("supersedes_proposal_id", proposalId)
    .limit(1);
  const supersededBy = supersededByRows?.[0] ?? null;

  interface CustomerRow {
    id: string;
    name: string;
    email: string | null;
    address: string | null;
    show_country_on_invoice: boolean | null;
    accent_color: string | null;
    logo_url: string | null;
  }
  const customer = Array.isArray(proposal.customers)
    ? ((proposal.customers[0] ?? null) as CustomerRow | null)
    : (proposal.customers as CustomerRow | null);
  const signer = Array.isArray(proposal.customer_contacts)
    ? ((proposal.customer_contacts[0] ?? null) as {
        name: string;
        email: string;
      } | null)
    : (proposal.customer_contacts as { name: string; email: string } | null);

  // Build the item tree: top-level items in order, phases nested.
  const rows = (itemRows ?? []) as LineItemRow[];
  const parents = rows.filter((r) => r.parent_line_item_id === null);
  const items: ProposalPDFItem[] = parents.map((parent) => ({
    title: parent.title,
    description: parent.description,
    whyItMatters: parent.why_it_matters,
    outOfScope: parent.out_of_scope,
    definitionOfDone: parent.definition_of_done,
    fixedPrice: Number(parent.fixed_price),
    isCapped: parent.is_capped,
    phases: rows
      .filter((r) => r.parent_line_item_id === parent.id)
      .map((phase) => ({
        title: phase.title,
        fixedPrice: Number(phase.fixed_price),
      })),
  }));
  const total = roundMoney(items.reduce((sum, i) => sum + i.fixedPrice, 0));
  const currency = (proposal.currency as string) ?? "USD";
  const status = (proposal.status as string) ?? "draft";
  const editable = isProposalEditable(status);

  // Send-readiness (only for an editable draft): the same completeness rules
  // the send action enforces, surfaced as a checklist so the author sees what
  // to finish before the Send button unlocks. `items` already carries the
  // title / fixedPrice / phases shape the readiness rule inspects.
  const tReady = await getTranslations("proposals.readiness");
  const sendBlockers = editable
    ? proposalSendReadiness({
        title: (proposal.title as string | null) ?? null,
        signerContactId: (proposal.signer_contact_id as string | null) ?? null,
        items: items.map((item) => ({
          title: item.title,
          fixedPrice: item.fixedPrice,
          phases: item.phases,
        })),
      }).map((issue) => tReady(issue.key, issue.params))
    : [];

  // Accepted-but-unbilled items drive the "Create invoice" affordance.
  const acceptedIds = new Set(
    ((acceptance?.selected_line_item_ids as string[] | null) ?? []),
  );
  const hasUnbilledAccepted =
    acceptance?.decision === "accepted" &&
    parents.some(
      (row) => acceptedIds.has(row.id) && row.invoiced_at === null,
    );

  const pdfBundle: ProposalPdfBundle = {
    proposal: {
      proposal_number: proposal.proposal_number as string,
      title: proposal.title as string,
      issued_date: (proposal.issued_date as string | null) ?? null,
      valid_until: (proposal.valid_until as string | null) ?? null,
      payment_terms_label:
        (proposal.payment_terms_label as string | null) ?? null,
      deposit_type: (proposal.deposit_type as DepositType) ?? "none",
      deposit_value:
        proposal.deposit_value != null ? Number(proposal.deposit_value) : null,
      warranty_days: (proposal.warranty_days as number | null) ?? null,
      terms_notes: (proposal.terms_notes as string | null) ?? null,
      currency,
    },
    items,
    total,
    client: customer,
    signerName: signer?.name ?? null,
    business: branding ?? null,
  };

  return (
    <div className="max-w-[880px]">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-page-title font-semibold text-content">
              {proposal.title as string}
            </h1>
            <ProposalStatusBadge status={status} size="prominent" />
          </div>
          <p className="mt-1 font-mono text-caption text-content-secondary">
            {proposal.proposal_number as string}
            {((proposal.version_number as number) ?? 1) > 1 &&
              ` · v${proposal.version_number as number}`}
          </p>
          {(supersedesRow || supersededBy) && (
            <p className="mt-1 text-caption text-content-secondary">
              {supersedesRow && (
                <>
                  {t("supersedes")}{" "}
                  <Link
                    href={`/proposals/${supersedesRow.id as string}`}
                    className="font-mono text-accent hover:underline"
                  >
                    {supersedesRow.proposal_number as string}
                  </Link>
                </>
              )}
              {supersedesRow && supersededBy && " · "}
              {supersededBy && (
                <>
                  {t("supersededBy")}{" "}
                  <Link
                    href={`/proposals/${supersededBy.id as string}`}
                    className="font-mono text-accent hover:underline"
                  >
                    {supersededBy.proposal_number as string}
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/proposals/${proposalId}/preview`}
            className={buttonSecondaryClass}
          >
            <Eye size={16} aria-hidden="true" />
            {t("preview")}
          </Link>
          <ProposalPdfButton bundle={pdfBundle} />
          {editable && (
            <>
              <SendProposalButton
                proposalId={proposalId}
                blockers={sendBlockers}
                signerEmail={signer?.email ?? null}
              />
              <Link
                href={`/proposals/${proposalId}/edit`}
                className={buttonSecondaryClass}
              >
                <Pencil size={16} aria-hidden="true" />
                {t("edit")}
              </Link>
              <DeleteProposalButton proposalId={proposalId} />
            </>
          )}
          {status === "accepted" && acceptance && !acceptance.provider_signed_at && (
            <CounterSignButton proposalId={proposalId} />
          )}
          {status === "accepted" && (
            <ConvertProposalButton proposalId={proposalId} />
          )}
          {(status === "accepted" || status === "converted") &&
            hasUnbilledAccepted && (
              <CreateInvoiceButton proposalId={proposalId} />
            )}
          {(status === "sent" || status === "viewed" || status === "declined") &&
            !supersededBy && <NewVersionButton proposalId={proposalId} />}
        </div>
      </div>

      {/* meta */}
      <dl className="mt-[24px] grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
        <div>
          <dt className="text-caption text-content-secondary">
            {t("customer")}
          </dt>
          <dd className="text-body text-content">
            <span className="inline-flex items-center gap-2">
              <CustomerChip
                customerId={customer?.id}
                customerName={customer?.name}
              />
              {customer?.name ?? "—"}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-caption text-content-secondary">{t("signer")}</dt>
          <dd className="text-body text-content">{signer?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-caption text-content-secondary">{t("issued")}</dt>
          <dd className="text-body text-content">
            {(proposal.issued_date as string | null) ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-content-secondary">
            {t("validUntil")}
          </dt>
          <dd className="text-body text-content">
            {(proposal.valid_until as string | null) ?? "—"}
          </dd>
        </div>
      </dl>

      {/* items */}
      <h2 className="mt-[32px] text-title font-semibold text-content">
        {t("itemsHeading")}
      </h2>
      <div className="mt-3 space-y-[12px]">
        {items.map((item, i) => (
          <div key={i} className="rounded-lg border border-edge p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body-lg font-semibold text-content">
                {item.title}
                {parents[i]?.converted_project_id && (
                  <Link
                    href={`/projects/${parents[i]!.converted_project_id}`}
                    className="ml-2 text-caption font-normal text-accent hover:underline"
                  >
                    {t("viewProject")}
                  </Link>
                )}
              </span>
              <span className="font-mono text-body-lg text-content">
                {formatCurrency(item.fixedPrice, currency)}
              </span>
            </div>
            {item.description && (
              <p className="mt-1 text-body text-content-secondary">
                {item.description}
              </p>
            )}
            <div className="mt-2 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              {item.whyItMatters && (
                <div>
                  <p className="text-label font-semibold uppercase text-content-muted">
                    {t("whyItMatters")}
                  </p>
                  <p className="text-body text-content-secondary">
                    {item.whyItMatters}
                  </p>
                </div>
              )}
              {item.outOfScope && (
                <div>
                  <p className="text-label font-semibold uppercase text-content-muted">
                    {t("outOfScope")}
                  </p>
                  <p className="text-body text-content-secondary">
                    {item.outOfScope}
                  </p>
                </div>
              )}
              {item.definitionOfDone && (
                <div>
                  <p className="text-label font-semibold uppercase text-content-muted">
                    {t("definitionOfDone")}
                  </p>
                  <p className="text-body text-content-secondary">
                    {item.definitionOfDone}
                  </p>
                </div>
              )}
            </div>
            {item.phases.length > 0 && (
              <div className="mt-3 border-t border-edge pt-2">
                <p className="text-label font-semibold uppercase text-content-muted">
                  {t("phasesHeading")}
                  {item.isCapped && (
                    <span className="ml-2 rounded-full bg-surface-inset px-2 py-0.5 text-label normal-case text-content-secondary">
                      {t("capped")}
                    </span>
                  )}
                </p>
                <ul className="mt-1 space-y-1">
                  {item.phases.map((phase, j) => (
                    <li
                      key={j}
                      className="flex items-baseline justify-between pl-[16px] text-body"
                    >
                      <span className="text-content-secondary">
                        {phase.title}
                      </span>
                      <span className="font-mono text-content-secondary">
                        {formatCurrency(phase.fixedPrice, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* total */}
      <div className="mt-4 flex items-baseline justify-between border-t border-edge pt-3">
        <span className="text-body-lg font-semibold text-content">
          {t("total")}
        </span>
        <span className="font-mono text-title font-semibold text-content">
          {formatCurrency(total, currency)}
        </span>
      </div>

      {/* terms */}
      <h2 className="mt-[32px] text-title font-semibold text-content">
        {t("termsHeading")}
      </h2>
      <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-3">
        <div>
          <dt className="text-caption text-content-secondary">
            {t("paymentTerms")}
          </dt>
          <dd className="text-body text-content">
            {(proposal.payment_terms_label as string | null) ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-content-secondary">
            {t("deposit")}
          </dt>
          <dd className="text-body text-content">
            {proposal.deposit_type === "percent" && proposal.deposit_value != null
              ? t("depositPercentValue", {
                  value: Number(proposal.deposit_value),
                })
              : proposal.deposit_type === "amount" &&
                  proposal.deposit_value != null
                ? formatCurrency(Number(proposal.deposit_value), currency)
                : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-content-secondary">
            {t("warranty")}
          </dt>
          <dd className="text-body text-content">
            {proposal.warranty_days != null
              ? t("warrantyDaysValue", {
                  days: proposal.warranty_days as number,
                })
              : "—"}
          </dd>
        </div>
      </dl>
      {typeof proposal.terms_notes === "string" && proposal.terms_notes && (
        <p className="mt-2 whitespace-pre-wrap text-body text-content-secondary">
          {proposal.terms_notes}
        </p>
      )}

      {/* Multi-signer roster + progress (only when 2+ signers). */}
      {roster.length > 1 && (
        <section className="mt-[32px]">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-title font-semibold text-content">
              {t("signersHeading")}
            </h2>
            <span className="text-caption text-content-secondary">
              {t("signersProgress", {
                signed: signedCount,
                total: roster.length,
              })}
              {" · "}
              {(proposal.signing_mode as string) === "all"
                ? t("modeAllShort")
                : t("modeFirstShort")}
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {roster.map((signer, i) => (
              <li
                key={signer.id}
                className="flex items-center gap-2 rounded-lg border border-edge bg-surface-raised p-3"
              >
                {signer.decision === "accepted" ? (
                  <CheckCircle2
                    size={16}
                    aria-hidden="true"
                    className="text-success"
                  />
                ) : signer.decision === "declined" ? (
                  <XCircle size={16} aria-hidden="true" className="text-error" />
                ) : (
                  <Clock
                    size={16}
                    aria-hidden="true"
                    className="text-content-muted"
                  />
                )}
                <span className="flex-1 text-body text-content">
                  {signer.name}
                  {signer.roleLabel ? (
                    <span className="text-content-muted"> · {signer.roleLabel}</span>
                  ) : null}
                  {i === 0 ? (
                    <span className="ml-1 text-caption text-accent">
                      {t("primarySigner")}
                    </span>
                  ) : null}
                </span>
                <span className="text-caption text-content-secondary">
                  {signer.decision === "accepted"
                    ? t("signerSigned")
                    : signer.decision === "declined"
                      ? t("signerDeclined")
                      : t("signerPending")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sign-off state */}
      {(signToken || acceptance) && (
        <>
          <h2 className="mt-[32px] text-title font-semibold text-content">
            {t("signoffHeading")}
          </h2>
          {signToken && !acceptance && (
            <p className="mt-2 text-body text-content-secondary">
              {t("sentTo", { email: signToken.signer_email as string })}
              {" · "}
              {t("linkExpires", {
                date: (signToken.expires_at as string).slice(0, 10),
              })}
              {signToken.first_viewed_at ? ` · ${t("viewedBadge")}` : ""}
            </p>
          )}
          {acceptance && (
            <div className="mt-2 rounded-lg border border-edge bg-surface-raised p-4">
              <p className="text-body-lg font-semibold text-content">
                {acceptance.decision === "accepted"
                  ? t("acceptedBy", { name: acceptance.signer_name as string })
                  : t("declinedBy", { name: acceptance.signer_name as string })}
              </p>
              <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-1 text-body sm:grid-cols-2">
                {acceptance.signer_title && (
                  <div className="flex gap-2">
                    <dt className="text-content-secondary">
                      {t("signerTitleLabel")}:
                    </dt>
                    <dd className="text-content">
                      {acceptance.signer_title as string}
                    </dd>
                  </div>
                )}
                {acceptance.signature_typed && (
                  <div className="flex gap-2">
                    <dt className="text-content-secondary">
                      {t("signatureLabel")}:
                    </dt>
                    <dd className="italic text-content">
                      {acceptance.signature_typed as string}
                    </dd>
                  </div>
                )}
                {acceptance.decision === "accepted" && (
                  <>
                    <div className="flex gap-2">
                      <dt className="text-content-secondary">
                        {t("acceptedTotalLabel")}:
                      </dt>
                      <dd className="font-mono font-semibold text-content">
                        {formatCurrency(
                          Number(acceptance.accepted_total ?? 0),
                          currency,
                        )}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-content-secondary">
                        {t("acceptedItems", {
                          count: (acceptance.selected_line_item_ids as string[])
                            .length,
                        })}
                      </dt>
                    </div>
                  </>
                )}
                <div className="flex gap-2">
                  <dt className="text-content-secondary">{t("ipLabel")}:</dt>
                  <dd className="font-mono text-content-secondary">
                    {(acceptance.ip_address as string | null) ?? "—"}
                  </dd>
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <dt className="text-content-secondary">
                    {t("recordHash")}:
                  </dt>
                  <dd className="break-all font-mono text-label text-content-muted">
                    {acceptance.content_sha256 as string}
                  </dd>
                </div>
                {acceptance.provider_signed_at && (
                  <div className="flex gap-2">
                    <dt className="text-content-secondary">
                      {t("countersigned")}:
                    </dt>
                    <dd className="text-content">
                      {(acceptance.provider_signed_at as string).slice(0, 10)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </>
      )}

      {/* Activity */}
      <h2 className="mt-[32px] text-title font-semibold text-content">
        {tActivity("heading")}
      </h2>
      {events.length === 0 ? (
        <p className="mt-2 text-body text-content-secondary">
          {tActivity("empty")}
        </p>
      ) : (
        <ol className="mt-2 space-y-1">
          {events.map((event) => (
            <li
              key={event.id as string}
              className="flex flex-wrap items-baseline gap-2 text-body"
            >
              <span className="font-mono text-caption text-content-muted">
                {(event.occurred_at as string).slice(0, 16).replace("T", " ")}
              </span>
              <span className="text-content">
                {tActivity(`event.${event.event_type as string}`)}
              </span>
              {event.actor_label && (
                <span className="text-caption text-content-secondary">
                  {event.actor_label as string}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
