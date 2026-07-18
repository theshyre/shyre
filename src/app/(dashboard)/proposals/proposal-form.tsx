"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, Trash2, TriangleAlert, CheckCircle2, Check } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldError } from "@/components/FieldError";
import { AutoTextarea } from "@/components/AutoTextarea";
import { DateField } from "@/components/DateField";
import { PaymentTermsField } from "@/components/PaymentTermsField";
import { useFormAction } from "@/hooks/use-form-action";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonSecondaryClass,
  buttonGhostClass,
  kbdClass,
} from "@/lib/form-styles";
import { formatCurrency } from "@/lib/invoice-utils";
import {
  roundMoney,
  phaseSum,
  proposalTotal,
  selectedTotal,
  type ProposalItemInput,
} from "@/lib/proposals/line-items";
import { proposalDraftSchema } from "@/lib/schemas/proposal";
import { MarkdownView } from "@/components/MarkdownView";
import { SIGN_THEMES, type DepositType, type SignTheme } from "@/lib/proposals/allow-lists";
import { createProposalAction, updateProposalAction } from "./actions";

export interface TeamOption {
  id: string;
  name: string;
}
export interface CustomerOption {
  id: string;
  name: string;
  team_id: string;
}
export interface ContactOption {
  id: string;
  name: string;
  email: string;
  customer_id: string;
  role_label: string | null;
}

interface PhaseState {
  key: string;
  title: string;
  description: string;
  fixedPrice: string;
}

interface ItemState {
  key: string;
  title: string;
  fixedPrice: string;
  summary: string;
  bodyMarkdown: string;
  isCapped: boolean;
  phases: PhaseState[];
}

export interface ProposalFormInitial {
  proposalId: string;
  team_id: string;
  customer_id: string;
  signer_contact_id: string | null;
  signers?: string[];
  signing_mode?: "first" | "all";
  title: string;
  issued_date: string | null;
  valid_until: string | null;
  payment_terms_days: number | null;
  deposit_type: DepositType;
  deposit_value: number | null;
  warranty_days: number | null;
  terms_notes: string | null;
  overview_markdown: string | null;
  sign_theme?: SignTheme;
  items: Array<{
    title: string;
    summary: string | null;
    bodyMarkdown: string | null;
    description: string | null;
    whyItMatters: string | null;
    outOfScope: string | null;
    definitionOfDone: string | null;
    fixedPrice: number;
    isCapped: boolean;
    phases: Array<{
      title: string;
      description: string | null;
      fixedPrice: number;
    }>;
  }>;
}

interface Props {
  /** Teams where the viewer is owner/admin — the only ones that can author. */
  teams: TeamOption[];
  customers: CustomerOption[];
  contacts: ContactOption[];
  initial?: ProposalFormInitial;
  /** Preselects the customer (and its team) on a NEW proposal —
   *  the customer-detail "New proposal" entry point. The page has
   *  already validated the id belongs to an authorable team.
   *  Ignored when editing (`initial` wins). */
  defaultCustomerId?: string | null;
}

/** Proposals are USD-only in v1 (DB default, no picker) — one constant so a
 *  future currency column threads through a single point. */
const FORM_CURRENCY = "USD";

/** Money input string → validated dollars. Empty is $0 (a free line item is
 *  legal); non-numeric garbage maps to -1 so the shared domain validator
 *  reports `priceInvalid` on the right field instead of a raw zod message. */
function parseMoney(v: string): number {
  const n = Number(v.trim() === "" ? 0 : v);
  return Number.isFinite(n) ? roundMoney(n) : -1;
}

function emptyToNull(v: string): string | null {
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/** Map the incoming draft (or a single blank item) onto editable state.
 *  Pure — initial keys live in an `init-*` namespace disjoint from the
 *  `new-*` keys handed out by the ref counter for rows added later, so no
 *  ref is touched during render. */
/** Migrate an item's legacy structured prose into a single markdown body, so a
 *  proposal authored before the markdown feature opens in the new editor with
 *  its content preserved (as markdown the author can keep editing). */
function composeLegacyBody(item: {
  bodyMarkdown?: string | null;
  description?: string | null;
  whyItMatters?: string | null;
  outOfScope?: string | null;
  definitionOfDone?: string | null;
}): string {
  if (item.bodyMarkdown && item.bodyMarkdown.trim() !== "") {
    return item.bodyMarkdown;
  }
  const parts: string[] = [];
  if (item.description?.trim()) parts.push(item.description.trim());
  if (item.whyItMatters?.trim())
    parts.push(`**Why it matters:** ${item.whyItMatters.trim()}`);
  if (item.outOfScope?.trim())
    parts.push(`**Out of scope:** ${item.outOfScope.trim()}`);
  if (item.definitionOfDone?.trim())
    parts.push(`**Definition of done:** ${item.definitionOfDone.trim()}`);
  return parts.join("\n\n");
}

function buildInitialItems(
  initial: ProposalFormInitial | undefined,
): ItemState[] {
  const source = initial?.items ?? [
    {
      title: "",
      summary: null,
      bodyMarkdown: null,
      description: null,
      whyItMatters: null,
      outOfScope: null,
      definitionOfDone: null,
      fixedPrice: 0,
      isCapped: false,
      phases: [],
    },
  ];
  return source.map((item, i) => ({
    key: `init-${i}`,
    title: item.title,
    fixedPrice: item.fixedPrice ? String(item.fixedPrice) : "",
    summary: item.summary ?? "",
    bodyMarkdown: composeLegacyBody(item),
    isCapped: item.isCapped,
    phases: item.phases.map((phase, j) => ({
      key: `init-${i}-${j}`,
      title: phase.title,
      description: phase.description ?? "",
      fixedPrice: phase.fixedPrice ? String(phase.fixedPrice) : "",
    })),
  }));
}

export function ProposalForm({
  teams,
  customers,
  contacts,
  initial,
  defaultCustomerId,
}: Props): React.JSX.Element {
  const t = useTranslations("proposals.form");
  const tv = useTranslations("proposals.validation");

  // Keys for rows added AFTER mount — only ever touched inside event
  // handlers, in a namespace disjoint from buildInitialItems' `init-*` keys.
  const keyCounter = useRef(0);
  const nextKey = useCallback((): string => `new-${++keyCounter.current}`, []);

  // Preselected customer (new-proposal-from-customer-page entry
  // point). Also pins the team so the customer picker actually
  // contains the preselected customer.
  const defaultCustomer =
    !initial && defaultCustomerId
      ? (customers.find((c) => c.id === defaultCustomerId) ?? null)
      : null;

  // ---- header state
  const [teamId, setTeamId] = useState(
    initial?.team_id ?? defaultCustomer?.team_id ?? teams[0]?.id ?? "",
  );
  const [customerId, setCustomerId] = useState(
    initial?.customer_id ?? defaultCustomer?.id ?? "",
  );
  // Signer roster (ordered contact ids; entry 0 is the primary). Seeded from
  // an explicit roster, else the single signer_contact_id, else empty.
  const [signers, setSigners] = useState<string[]>(
    () =>
      initial?.signers ??
      (initial?.signer_contact_id ? [initial.signer_contact_id] : []),
  );
  const [signingMode, setSigningMode] = useState<"first" | "all">(
    initial?.signing_mode ?? "first",
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [issuedDate, setIssuedDate] = useState(initial?.issued_date ?? "");
  const [validUntil, setValidUntil] = useState(initial?.valid_until ?? "");

  // ---- terms state
  const [termsDays, setTermsDays] = useState<number | null>(
    initial?.payment_terms_days ?? null,
  );
  const [depositType, setDepositType] = useState<DepositType>(
    initial?.deposit_type ?? "none",
  );
  const [depositValue, setDepositValue] = useState(
    initial?.deposit_value != null ? String(initial.deposit_value) : "",
  );
  const [warrantyDays, setWarrantyDays] = useState(
    initial?.warranty_days != null ? String(initial.warranty_days) : "",
  );
  const [termsNotes, setTermsNotes] = useState(initial?.terms_notes ?? "");
  const [signTheme, setSignTheme] = useState<SignTheme>(
    initial?.sign_theme ?? "light",
  );
  const [overviewMarkdown, setOverviewMarkdown] = useState(
    initial?.overview_markdown ?? "",
  );

  // ---- line items state (lazy initializer — runs once)
  const [items, setItems] = useState<ItemState[]>(() =>
    buildInitialItems(initial),
  );

  // ---- selection preview (which items the client might check). Keyed by
  // the item's STABLE key, never its index — removing a middle row must not
  // silently shift the checked state (and the money total) onto neighbors.
  const [previewSelected, setPreviewSelected] = useState<Set<string>>(
    () => new Set((initial?.items ?? [0]).map((_, i) => `init-${i}`)),
  );

  const patchItem = useCallback(
    (key: string, patch: Partial<ItemState>): void => {
      setItems((prev) =>
        prev.map((it) => (it.key === key ? { ...it, ...patch } : it)),
      );
    },
    [],
  );
  const patchPhase = useCallback(
    (itemKey: string, phaseKey: string, patch: Partial<PhaseState>): void => {
      setItems((prev) =>
        prev.map((it) =>
          it.key === itemKey
            ? {
                ...it,
                phases: it.phases.map((ph) =>
                  ph.key === phaseKey ? { ...ph, ...patch } : ph,
                ),
              }
            : it,
        ),
      );
    },
    [],
  );

  const domainItems: ProposalItemInput[] = useMemo(
    () =>
      items.map((it) => ({
        title: it.title.trim(),
        summary: emptyToNull(it.summary),
        bodyMarkdown: emptyToNull(it.bodyMarkdown),
        fixedPrice: parseMoney(it.fixedPrice),
        isCapped: it.phases.length > 0 ? it.isCapped : undefined,
        phases:
          it.phases.length > 0
            ? it.phases.map((ph) => ({
                title: ph.title.trim(),
                description: emptyToNull(ph.description),
                fixedPrice: parseMoney(ph.fixedPrice),
              }))
            : undefined,
      })),
    [items],
  );

  const buildPayload = useCallback(
    (): Record<string, unknown> => ({
      team_id: teamId,
      customer_id: customerId,
      signer_contact_id: signers[0] ?? null,
      signers,
      signing_mode: signers.length > 1 ? signingMode : "first",
      title: title.trim(),
      issued_date: issuedDate || null,
      valid_until: validUntil || null,
      payment_terms_days: termsDays,
      deposit_type: depositType,
      deposit_value:
        depositType === "none" ? null : parseMoney(depositValue),
      warranty_days: warrantyDays.trim() === "" ? null : Number(warrantyDays),
      terms_notes: emptyToNull(termsNotes),
      overview_markdown: emptyToNull(overviewMarkdown),
      sign_theme: signTheme,
      items: domainItems,
    }),
    [
      teamId,
      customerId,
      signers,
      signingMode,
      title,
      issuedDate,
      validUntil,
      termsDays,
      depositType,
      depositValue,
      warrantyDays,
      termsNotes,
      overviewMarkdown,
      signTheme,
      domainItems,
    ],
  );

  // Dirty baseline: the first render's payload snapshot, captured via a
  // useState initializer (never updated) — no render-time ref access.
  const currentPayloadJson = JSON.stringify(buildPayload());
  const [baselinePayload] = useState(currentPayloadJson);
  const isDirty = currentPayloadJson !== baselinePayload;

  const { pending, serverError, fieldErrors, handleSubmit } = useFormAction({
    // Save-as-you-go: the form persists a draft with whatever's filled in so
    // far. Completeness is checked at Send (the readiness checklist on the
    // detail page + the send action), never here — so save is never blocked.
    schema: proposalDraftSchema,
    action: initial ? updateProposalAction : createProposalAction,
    transform: (fd) => {
      try {
        return JSON.parse(fd.get("payload") as string) as unknown;
      } catch {
        return null;
      }
    },
  });

  useUnsavedChanges(isDirty && !pending);

  /** Field error for a path, translating domain keys to copy. Unknown
   *  messages (raw zod text) pass through untouched. */
  const errorFor = useCallback(
    (path: string): string | null => {
      const raw = fieldErrors[path];
      if (!raw) return null;
      try {
        const translated = tv(raw);
        if (translated && !translated.includes("proposals.validation"))
          return translated;
      } catch {
        // not one of ours — fall through
      }
      return raw;
    },
    [fieldErrors, tv],
  );

  const onSubmit = useCallback(
    (formData: FormData): Promise<void> => {
      formData.set("payload", JSON.stringify(buildPayload()));
      if (initial) formData.set("id", initial.proposalId);
      return handleSubmit(formData);
    },
    [buildPayload, handleSubmit, initial],
  );

  const teamCustomers = customers.filter((c) => c.team_id === teamId);
  const customerContacts = contacts.filter(
    (c) => c.customer_id === customerId,
  );
  const availableContacts = customerContacts.filter(
    (c) => !signers.includes(c.id),
  );
  const total = proposalTotal(domainItems);
  const previewTotal = selectedTotal(
    domainItems,
    items
      .map((item, i) => (previewSelected.has(item.key) ? i : -1))
      .filter((i) => i >= 0),
  );

  return (
    <form
      action={onSubmit}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.currentTarget.requestSubmit();
        }
      }}
      className="max-w-[880px] space-y-[24px]"
    >
      {/* ---- header ---- */}
      <section className="space-y-4">
        {teams.length > 1 && (
          <div>
            <label htmlFor="pf-team" className={labelClass}>
              {t("team")}
            </label>
            <select
              id="pf-team"
              className={selectClass}
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setCustomerId("");
                setSigners([]);
              }}
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="pf-title" className={labelClass}>
            {t("title")}
          </label>
          <input
            id="pf-title"
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            required
            aria-describedby={errorFor("title") ? "pf-title-error" : undefined}
          />
          <FieldError id="pf-title-error" error={errorFor("title")} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pf-customer" className={labelClass}>
              {t("customer")}
            </label>
            <select
              id="pf-customer"
              className={selectClass}
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setSigners([]);
              }}
              required
              aria-describedby={
                errorFor("customer_id") ? "pf-customer-error" : undefined
              }
            >
              <option value="">{t("customerPlaceholder")}</option>
              {teamCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <FieldError id="pf-customer-error" error={errorFor("customer_id")} />
          </div>
          <div>
            <label htmlFor="pf-signer" className={labelClass}>
              {t("signersLabel")}
            </label>
            {signers.length > 0 && (
              <ul className="mb-2 space-y-1">
                {signers.map((id, i) => {
                  const c = contacts.find((x) => x.id === id);
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-2 rounded-md border border-edge bg-surface px-2 py-1 text-body"
                    >
                      <span className="flex-1 truncate">
                        {c ? c.name : id}
                        {c?.role_label ? (
                          <span className="text-content-muted">
                            {" "}
                            · {c.role_label}
                          </span>
                        ) : null}
                        {i === 0 && signers.length > 1 ? (
                          <span className="ml-1 text-caption text-accent">
                            {t("primarySigner")}
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setSigners((prev) => prev.filter((x) => x !== id))
                        }
                        className={buttonGhostClass}
                        aria-label={t("removeSigner")}
                      >
                        <Trash2 size={14} aria-hidden="true" className="text-error" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <select
              id="pf-signer"
              className={selectClass}
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v) setSigners((prev) => [...prev, v]);
              }}
              disabled={availableContacts.length === 0}
            >
              <option value="">
                {customerContacts.length === 0
                  ? t("signerNone")
                  : signers.length === 0
                    ? t("signerPlaceholder")
                    : t("addSigner")}
              </option>
              {availableContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.email})
                  {c.role_label ? ` — ${c.role_label}` : ""}
                </option>
              ))}
            </select>
            {signers.length > 1 && (
              <div className="mt-2">
                <div className="inline-flex overflow-hidden rounded-md border border-edge">
                  <button
                    type="button"
                    aria-pressed={signingMode === "first"}
                    onClick={() => setSigningMode("first")}
                    className={`px-3 py-1 text-caption ${
                      signingMode === "first"
                        ? "bg-accent-soft font-medium text-accent"
                        : "text-content-secondary hover:text-content"
                    }`}
                  >
                    {t("modeFirst")}
                  </button>
                  <button
                    type="button"
                    aria-pressed={signingMode === "all"}
                    onClick={() => setSigningMode("all")}
                    className={`border-l border-edge px-3 py-1 text-caption ${
                      signingMode === "all"
                        ? "bg-accent-soft font-medium text-accent"
                        : "text-content-secondary hover:text-content"
                    }`}
                  >
                    {t("modeAll")}
                  </button>
                </div>
                <p className="mt-1 text-caption text-content-muted">
                  {signingMode === "all" ? t("modeAllHint") : t("modeFirstHint")}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pf-issued" className={labelClass}>
              {t("issuedDate")}
            </label>
            <DateField
              id="pf-issued"
              value={issuedDate}
              onChange={setIssuedDate}
            />
          </div>
          <div>
            <label htmlFor="pf-valid-until" className={labelClass}>
              {t("validUntil")}
            </label>
            <DateField
              id="pf-valid-until"
              value={validUntil}
              onChange={setValidUntil}
              min={issuedDate || undefined}
            />
            <FieldError id="pf-valid-until-error" error={errorFor("valid_until")} />
          </div>
        </div>
      </section>

      {/* ---- overview (markdown) ---- */}
      <section>
        <label htmlFor="pf-overview" className={labelClass}>
          {t("overviewLabel")}
        </label>
        <AutoTextarea
          id="pf-overview"
          className={inputClass}
          minRows={3}
          value={overviewMarkdown}
          placeholder={t("overviewPlaceholder")}
          onChange={(e) => setOverviewMarkdown(e.target.value)}
        />
        <p className="mt-1 text-caption text-content-muted">
          {t("overviewHint")}
        </p>
        {overviewMarkdown.trim() !== "" && (
          <details className="mt-2">
            <summary className="cursor-pointer text-caption text-accent">
              {t("itemBodyPreview")}
            </summary>
            <div className="mt-2 rounded-lg border border-edge bg-surface p-3">
              <MarkdownView content={overviewMarkdown} />
            </div>
          </details>
        )}
      </section>

      {/* ---- line items ---- */}
      <section>
        <h2 className="text-title font-semibold text-content">
          {t("itemsHeading")}
        </h2>
        <p className="mt-1 text-caption text-content-secondary">
          {t("itemsHint")}
        </p>
        <FieldError error={errorFor("items")} />

        <div className="mt-3 space-y-[16px]">
          {items.map((item, i) => {
            const sum = phaseSum(domainItems[i] ?? { title: "", fixedPrice: 0 });
            const target = parseMoney(item.fixedPrice);
            const phasesMatch = item.phases.length === 0 || sum === target;
            return (
              <div
                key={item.key}
                className="rounded-lg border border-edge bg-surface-raised p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <label
                      htmlFor={`pf-item-title-${item.key}`}
                      className={labelClass}
                    >
                      {t("itemTitle")}
                    </label>
                    <input
                      id={`pf-item-title-${item.key}`}
                      className={inputClass}
                      value={item.title}
                      onChange={(e) =>
                        patchItem(item.key, { title: e.target.value })
                      }
                      aria-describedby={
                        errorFor(`items.${i}.title`)
                          ? `pf-item-title-err-${item.key}`
                          : undefined
                      }
                    />
                    <FieldError
                      id={`pf-item-title-err-${item.key}`}
                      error={errorFor(`items.${i}.title`)}
                    />
                  </div>
                  <div className="w-[140px]">
                    <label
                      htmlFor={`pf-item-price-${item.key}`}
                      className={labelClass}
                    >
                      {t("itemPrice")}
                    </label>
                    <input
                      id={`pf-item-price-${item.key}`}
                      className={inputClass}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={item.fixedPrice}
                      onChange={(e) =>
                        patchItem(item.key, { fixedPrice: e.target.value })
                      }
                      aria-describedby={
                        errorFor(`items.${i}.fixedPrice`)
                          ? `pf-item-price-err-${item.key}`
                          : undefined
                      }
                    />
                    <FieldError
                      id={`pf-item-price-err-${item.key}`}
                      error={errorFor(`items.${i}.fixedPrice`)}
                    />
                  </div>
                  {items.length > 1 && (
                    <button
                      type="button"
                      className={`${buttonGhostClass} mt-[26px] shrink-0 px-2 text-error`}
                      onClick={() =>
                        setItems((prev) =>
                          prev.filter((it) => it.key !== item.key),
                        )
                      }
                      aria-label={t("removeItem")}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>

                <div className="mt-3">
                  <label
                    htmlFor={`pf-item-summary-${item.key}`}
                    className={labelClass}
                  >
                    {t("itemSummary")}
                  </label>
                  <input
                    id={`pf-item-summary-${item.key}`}
                    className={inputClass}
                    value={item.summary}
                    placeholder={t("itemSummaryPlaceholder")}
                    onChange={(e) =>
                      patchItem(item.key, { summary: e.target.value })
                    }
                  />
                  <p className="mt-1 text-caption text-content-muted">
                    {t("itemSummaryHint")}
                  </p>
                </div>

                <div className="mt-3">
                  <label
                    htmlFor={`pf-item-body-${item.key}`}
                    className={labelClass}
                  >
                    {t("itemBody")}
                  </label>
                  <AutoTextarea
                    id={`pf-item-body-${item.key}`}
                    className={inputClass}
                    minRows={4}
                    value={item.bodyMarkdown}
                    placeholder={t("itemBodyPlaceholder")}
                    onChange={(e) =>
                      patchItem(item.key, { bodyMarkdown: e.target.value })
                    }
                  />
                  <p className="mt-1 text-caption text-content-muted">
                    {t("itemBodyHint")}
                  </p>
                  {item.bodyMarkdown.trim() !== "" && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-caption text-accent">
                        {t("itemBodyPreview")}
                      </summary>
                      <div className="mt-2 rounded-lg border border-edge bg-surface p-3">
                        <MarkdownView content={item.bodyMarkdown} />
                      </div>
                    </details>
                  )}
                </div>

                {/* phases */}
                <div className="mt-3 border-t border-edge pt-3">
                  {item.phases.map((phase, j) => (
                    <div key={phase.key} className="mb-2 flex items-start gap-3">
                      <div className="flex-1">
                        <input
                          className={inputClass}
                          placeholder={t("phaseTitle")}
                          aria-label={t("phaseTitle")}
                          value={phase.title}
                          onChange={(e) =>
                            patchPhase(item.key, phase.key, {
                              title: e.target.value,
                            })
                          }
                          aria-describedby={
                            errorFor(`items.${i}.phases.${j}.title`)
                              ? `pf-phase-title-err-${phase.key}`
                              : undefined
                          }
                        />
                        <FieldError
                          id={`pf-phase-title-err-${phase.key}`}
                          error={errorFor(`items.${i}.phases.${j}.title`)}
                        />
                        <input
                          className={`${inputClass} mt-1`}
                          placeholder={t("phaseDescription")}
                          aria-label={t("phaseDescription")}
                          value={phase.description}
                          onChange={(e) =>
                            patchPhase(item.key, phase.key, {
                              description: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="w-[140px]">
                        <input
                          className={inputClass}
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          placeholder="0.00"
                          aria-label={t("phasePrice")}
                          value={phase.fixedPrice}
                          onChange={(e) =>
                            patchPhase(item.key, phase.key, {
                              fixedPrice: e.target.value,
                            })
                          }
                          aria-describedby={
                            errorFor(`items.${i}.phases.${j}.fixedPrice`)
                              ? `pf-phase-price-err-${phase.key}`
                              : undefined
                          }
                        />
                        <FieldError
                          id={`pf-phase-price-err-${phase.key}`}
                          error={errorFor(`items.${i}.phases.${j}.fixedPrice`)}
                        />
                      </div>
                      <button
                        type="button"
                        className={`${buttonGhostClass} shrink-0 px-2 text-error`}
                        onClick={() =>
                          patchItem(item.key, {
                            phases: item.phases.filter(
                              (ph) => ph.key !== phase.key,
                            ),
                          })
                        }
                        aria-label={t("removePhase")}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))}

                  <div className="flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      className={buttonGhostClass}
                      onClick={() =>
                        patchItem(item.key, {
                          phases: [
                            ...item.phases,
                            {
                              key: nextKey(),
                              title: "",
                              description: "",
                              fixedPrice: "",
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={14} aria-hidden="true" />
                      {t("addPhase")}
                    </button>

                    {item.phases.length > 0 && (
                      <>
                        <label className="flex items-center gap-2 text-body text-content">
                          <input
                            type="checkbox"
                            checked={item.isCapped}
                            onChange={(e) =>
                              patchItem(item.key, {
                                isCapped: e.target.checked,
                              })
                            }
                          />
                          {t("capped")}
                        </label>
                        <span
                          className={`inline-flex items-center gap-1 text-caption ${
                            phasesMatch ? "text-success-text" : "text-error"
                          }`}
                        >
                          {phasesMatch ? (
                            <CheckCircle2 size={12} aria-hidden="true" />
                          ) : (
                            <TriangleAlert size={12} aria-hidden="true" />
                          )}
                          {phasesMatch
                            ? t("phasesMatch")
                            : t("phasesMismatch", {
                                expected: formatCurrency(
                                  Math.max(target, 0),
                                  FORM_CURRENCY,
                                ),
                                actual: formatCurrency(Math.max(sum, 0), FORM_CURRENCY),
                              })}
                        </span>
                      </>
                    )}
                  </div>
                  <FieldError error={errorFor(`items.${i}.phases`)} />
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className={`${buttonSecondaryClass} mt-3`}
          onClick={() => {
            const key = nextKey();
            setItems((prev) => [
              ...prev,
              {
                key,
                title: "",
                fixedPrice: "",
                summary: "",
                bodyMarkdown: "",
                isCapped: false,
                phases: [],
              },
            ]);
            // New items start SELECTED in the preview — matching the initial
            // state, so the preview total never silently under-reports.
            setPreviewSelected((prev) => new Set(prev).add(key));
          }}
        >
          <Plus size={16} aria-hidden="true" />
          {t("addItem")}
        </button>
      </section>

      {/* ---- client-selection preview ---- */}
      <section className="rounded-lg border border-edge bg-surface-inset p-4">
        <h2 className="text-body-lg font-semibold text-content">
          {t("previewHeading")}
        </h2>
        <p className="mt-1 text-caption text-content-secondary">
          {t("previewHint")}
        </p>
        <ul className="mt-2 space-y-1">
          {items.map((item, i) => (
            <li key={item.key}>
              <label className="flex items-center gap-2 text-body text-content">
                <input
                  type="checkbox"
                  checked={previewSelected.has(item.key)}
                  onChange={(e) => {
                    setPreviewSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(item.key);
                      else next.delete(item.key);
                      return next;
                    });
                  }}
                />
                <span className="flex-1">
                  {item.title.trim() || t("untitledItem", { n: i + 1 })}
                </span>
                <span className="font-mono text-caption">
                  {formatCurrency(Math.max(parseMoney(item.fixedPrice), 0), FORM_CURRENCY)}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-edge pt-2 text-body-lg">
          <span className="text-content-secondary">
            {t("previewSelectedTotal")}
          </span>
          <span className="font-mono font-semibold text-content">
            {formatCurrency(previewTotal, FORM_CURRENCY)}
          </span>
        </div>
        <div className="mt-1 flex justify-between text-caption text-content-secondary">
          <span>{t("previewFullTotal")}</span>
          <span className="font-mono">{formatCurrency(total, FORM_CURRENCY)}</span>
        </div>
      </section>

      {/* ---- terms ---- */}
      <section className="space-y-4">
        <h2 className="text-title font-semibold text-content">
          {t("termsHeading")}
        </h2>

        <PaymentTermsField
          name="payment_terms_days"
          label={t("paymentTerms")}
          value={termsDays}
          inheritLabel={t("paymentTermsNone")}
          onChange={setTermsDays}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="pf-deposit-type" className={labelClass}>
              {t("deposit")}
            </label>
            <select
              id="pf-deposit-type"
              className={selectClass}
              value={depositType}
              onChange={(e) => setDepositType(e.target.value as DepositType)}
            >
              <option value="none">{t("depositNone")}</option>
              <option value="percent">{t("depositPercent")}</option>
              <option value="amount">{t("depositAmount")}</option>
            </select>
          </div>
          {depositType !== "none" && (
            <div>
              <label htmlFor="pf-deposit-value" className={labelClass}>
                {depositType === "percent"
                  ? t("depositValuePercent")
                  : t("depositValueAmount")}
              </label>
              <input
                id="pf-deposit-value"
                className={inputClass}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={depositValue}
                onChange={(e) => setDepositValue(e.target.value)}
                aria-describedby={
                  errorFor("deposit_value") ? "pf-deposit-value-error" : undefined
                }
              />
              <FieldError id="pf-deposit-value-error" error={errorFor("deposit_value")} />
            </div>
          )}
          <div>
            <label htmlFor="pf-warranty" className={labelClass}>
              {t("warrantyDays")}
            </label>
            <input
              id="pf-warranty"
              className={inputClass}
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={warrantyDays}
              onChange={(e) => setWarrantyDays(e.target.value)}
              aria-describedby={
                errorFor("warranty_days") ? "pf-warranty-error" : undefined
              }
            />
            <FieldError id="pf-warranty-error" error={errorFor("warranty_days")} />
          </div>
        </div>

        <div>
          <label htmlFor="pf-terms-notes" className={labelClass}>
            {t("termsNotes")}
          </label>
          <AutoTextarea
            id="pf-terms-notes"
            className={inputClass}
            minRows={3}
            value={termsNotes}
            onChange={(e) => setTermsNotes(e.target.value)}
          />
        </div>
      </section>

      {/* ---- sign-page appearance ---- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-title font-semibold text-content">
            {t("appearanceHeading")}
          </h2>
          <p className="mt-1 text-caption text-content-secondary">
            {t("appearanceHint")}
          </p>
        </div>
        <fieldset>
          <legend className="sr-only">{t("appearanceHeading")}</legend>
          <div className="flex flex-wrap gap-3">
            {SIGN_THEMES.map((opt) => {
              const checked = signTheme === opt;
              return (
                <label
                  key={opt}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                    checked
                      ? "border-accent bg-accent-soft"
                      : "border-edge hover:bg-hover"
                  }`}
                >
                  <input
                    type="radio"
                    name="pf-sign-theme"
                    value={opt}
                    checked={checked}
                    onChange={() => setSignTheme(opt)}
                    className="sr-only"
                  />
                  {/* Live mini-swatch: data-theme resolves the theme's own
                      tokens, so this previews the real client colors. */}
                  <span
                    data-theme={opt}
                    aria-hidden="true"
                    className="flex h-8 w-11 items-center justify-center gap-1 rounded border border-edge bg-surface"
                  >
                    <span className="h-3 w-3 rounded-full bg-content" />
                    <span className="h-3 w-3 rounded-full bg-accent" />
                  </span>
                  <span className="flex items-center gap-1.5 text-body-lg font-medium text-content">
                    {checked && (
                      <Check
                        size={14}
                        aria-hidden="true"
                        className="text-accent"
                      />
                    )}
                    {t(`signTheme.${opt}`)}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </section>

      {/* ---- footer ---- */}
      {serverError && (
        <p
          role="alert"
          className="flex items-center gap-1 text-body text-error"
        >
          <TriangleAlert size={14} aria-hidden="true" />
          {serverError}
        </p>
      )}
      <div className="flex items-center gap-3">
        <SubmitButton
          label={initial ? t("saveDraft") : t("createDraft")}
          pending={pending}
        />
        <kbd className={kbdClass} aria-hidden="true">
          ⌘↵
        </kbd>
        {pending ? (
          <span className={`${buttonSecondaryClass} opacity-50`} aria-disabled="true">
            {t("cancel")}
          </span>
        ) : (
          <Link
            href={initial ? `/proposals/${initial.proposalId}` : "/proposals"}
            className={buttonSecondaryClass}
          >
            {t("cancel")}
          </Link>
        )}
      </div>
    </form>
  );
}
