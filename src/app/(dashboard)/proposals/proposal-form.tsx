"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, Trash2, TriangleAlert, CheckCircle2 } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { FieldError } from "@/components/FieldError";
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
import { proposalSchema } from "@/lib/schemas/proposal";
import type { DepositType } from "./allow-lists";
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
  description: string;
  whyItMatters: string;
  outOfScope: string;
  definitionOfDone: string;
  isCapped: boolean;
  phases: PhaseState[];
}

export interface ProposalFormInitial {
  proposalId: string;
  team_id: string;
  customer_id: string;
  signer_contact_id: string | null;
  title: string;
  issued_date: string | null;
  valid_until: string | null;
  payment_terms_days: number | null;
  deposit_type: DepositType;
  deposit_value: number | null;
  warranty_days: number | null;
  terms_notes: string | null;
  items: Array<{
    title: string;
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
function buildInitialItems(
  initial: ProposalFormInitial | undefined,
): ItemState[] {
  const source = initial?.items ?? [
    {
      title: "",
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
    description: item.description ?? "",
    whyItMatters: item.whyItMatters ?? "",
    outOfScope: item.outOfScope ?? "",
    definitionOfDone: item.definitionOfDone ?? "",
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
}: Props): React.JSX.Element {
  const t = useTranslations("proposals.form");
  const tv = useTranslations("proposals.validation");

  // Keys for rows added AFTER mount — only ever touched inside event
  // handlers, in a namespace disjoint from buildInitialItems' `init-*` keys.
  const keyCounter = useRef(0);
  const nextKey = useCallback((): string => `new-${++keyCounter.current}`, []);

  // ---- header state
  const [teamId, setTeamId] = useState(initial?.team_id ?? teams[0]?.id ?? "");
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? "");
  const [signerId, setSignerId] = useState(initial?.signer_contact_id ?? "");
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
        description: emptyToNull(it.description),
        whyItMatters: emptyToNull(it.whyItMatters),
        outOfScope: emptyToNull(it.outOfScope),
        definitionOfDone: emptyToNull(it.definitionOfDone),
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
      signer_contact_id: signerId || null,
      title: title.trim(),
      issued_date: issuedDate || null,
      valid_until: validUntil || null,
      payment_terms_days: termsDays,
      deposit_type: depositType,
      deposit_value:
        depositType === "none" ? null : parseMoney(depositValue),
      warranty_days: warrantyDays.trim() === "" ? null : Number(warrantyDays),
      terms_notes: emptyToNull(termsNotes),
      items: domainItems,
    }),
    [
      teamId,
      customerId,
      signerId,
      title,
      issuedDate,
      validUntil,
      termsDays,
      depositType,
      depositValue,
      warrantyDays,
      termsNotes,
      domainItems,
    ],
  );

  // Dirty baseline: the first render's payload snapshot, captured via a
  // useState initializer (never updated) — no render-time ref access.
  const currentPayloadJson = JSON.stringify(buildPayload());
  const [baselinePayload] = useState(currentPayloadJson);
  const isDirty = currentPayloadJson !== baselinePayload;

  const { pending, serverError, fieldErrors, handleSubmit } = useFormAction({
    schema: proposalSchema,
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
                setSignerId("");
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
                setSignerId("");
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
              {t("signer")}
            </label>
            <select
              id="pf-signer"
              className={selectClass}
              value={signerId}
              onChange={(e) => setSignerId(e.target.value)}
              disabled={customerContacts.length === 0}
            >
              <option value="">
                {customerContacts.length === 0
                  ? t("signerNone")
                  : t("signerPlaceholder")}
              </option>
              {customerContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.email})
                </option>
              ))}
            </select>
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

      {/* ---- line items ---- */}
      <section>
        <h2 className="text-heading font-semibold text-content">
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

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`pf-item-desc-${item.key}`}
                      className={labelClass}
                    >
                      {t("itemDescription")}
                    </label>
                    <textarea
                      id={`pf-item-desc-${item.key}`}
                      className={inputClass}
                      rows={2}
                      value={item.description}
                      onChange={(e) =>
                        patchItem(item.key, { description: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`pf-item-why-${item.key}`}
                      className={labelClass}
                    >
                      {t("itemWhy")}
                    </label>
                    <textarea
                      id={`pf-item-why-${item.key}`}
                      className={inputClass}
                      rows={2}
                      value={item.whyItMatters}
                      onChange={(e) =>
                        patchItem(item.key, { whyItMatters: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`pf-item-oos-${item.key}`}
                      className={labelClass}
                    >
                      {t("itemOutOfScope")}
                    </label>
                    <textarea
                      id={`pf-item-oos-${item.key}`}
                      className={inputClass}
                      rows={2}
                      value={item.outOfScope}
                      onChange={(e) =>
                        patchItem(item.key, { outOfScope: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`pf-item-dod-${item.key}`}
                      className={labelClass}
                    >
                      {t("itemDoD")}
                    </label>
                    <textarea
                      id={`pf-item-dod-${item.key}`}
                      className={inputClass}
                      rows={2}
                      value={item.definitionOfDone}
                      onChange={(e) =>
                        patchItem(item.key, {
                          definitionOfDone: e.target.value,
                        })
                      }
                    />
                  </div>
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
                description: "",
                whyItMatters: "",
                outOfScope: "",
                definitionOfDone: "",
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
        <h2 className="text-heading font-semibold text-content">
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
          <textarea
            id="pf-terms-notes"
            className={inputClass}
            rows={3}
            value={termsNotes}
            onChange={(e) => setTermsNotes(e.target.value)}
          />
        </div>
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
          label={initial ? t("save") : t("create")}
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
