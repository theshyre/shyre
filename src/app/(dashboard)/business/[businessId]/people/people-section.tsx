"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { UserCog, Plus, Pencil, X, Link2, Link2Off, History } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { DateField } from "@/components/DateField";
import { InlineDeleteRowConfirm } from "@/components/InlineDeleteRowConfirm";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { Tooltip } from "@/components/Tooltip";
import {
  inputClass,
  labelClass,
  selectClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonGhostClass,
} from "@/lib/form-styles";
import {
  createPersonAction,
  updatePersonAction,
  deletePersonAction,
} from "../../people-actions";
import { PersonHistoryDialog } from "./person-history-dialog";

export interface PersonRow {
  id: string;
  user_id: string | null;
  legal_name: string;
  preferred_name: string | null;
  work_email: string | null;
  work_phone: string | null;
  employment_type:
    | "w2_employee"
    | "1099_contractor"
    | "partner"
    | "owner"
    | "unpaid";
  title: string | null;
  department: string | null;
  employee_number: string | null;
  started_on: string | null;
  ended_on: string | null;
  compensation_type:
    | "salary"
    | "hourly"
    | "project_based"
    | "equity_only"
    | "unpaid"
    | null;
  compensation_amount_cents: number | null;
  compensation_currency: string | null;
  compensation_schedule:
    | "annual"
    | "monthly"
    | "biweekly"
    | "weekly"
    | "per_hour"
    | "per_project"
    | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  reports_to_person_id: string | null;
  notes: string | null;
}

export interface LinkableUser {
  user_id: string;
  display_name: string | null;
  email: string | null;
}

interface Props {
  businessId: string;
  people: PersonRow[];
  linkableUsers: LinkableUser[];
  canEdit: boolean;
}

type SectionKey = "employees" | "contractors" | "partnersOwners" | "other";

function sectionForPerson(p: PersonRow): SectionKey {
  switch (p.employment_type) {
    case "w2_employee":
      return "employees";
    case "1099_contractor":
      return "contractors";
    case "partner":
    case "owner":
      return "partnersOwners";
    case "unpaid":
    default:
      return "other";
  }
}

const SECTION_ORDER: SectionKey[] = [
  "partnersOwners",
  "employees",
  "contractors",
  "other",
];

const EMPLOYMENT_BADGE: Record<PersonRow["employment_type"], string> = {
  w2_employee: "bg-accent-soft text-accent-text",
  "1099_contractor": "bg-surface-inset text-content-secondary",
  partner: "bg-success-soft text-success-text",
  owner: "bg-success-soft text-success-text",
  unpaid: "bg-surface-inset text-content-muted",
};

export function PeopleSection({
  businessId,
  people,
  linkableUsers,
  canEdit,
}: Props): React.JSX.Element {
  const t = useTranslations("business.people");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const grouped = new Map<SectionKey, PersonRow[]>();
  for (const key of SECTION_ORDER) grouped.set(key, []);
  for (const p of people) grouped.get(sectionForPerson(p))!.push(p);
  for (const arr of grouped.values()) {
    arr.sort((a, b) => a.legal_name.localeCompare(b.legal_name));
  }

  return (
    <section
      className="space-y-3 rounded-lg border border-edge bg-surface-raised p-5"
      aria-labelledby="people-heading"
    >
      <div className="flex items-start gap-3 flex-wrap">
        <UserCog size={20} className="text-accent shrink-0 mt-0.5" />
        <div className="flex-1 min-w-[200px]">
          <h2
            id="people-heading"
            className="text-title font-semibold text-content"
          >
            {t("title")}
          </h2>
          <p className="mt-1 text-body text-content-secondary max-w-3xl">
            {t("description")}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start flex-wrap">
          {canEdit ? (
            <Link
              href={`/business/${businessId}/people/history`}
              className={`${buttonGhostClass} inline-flex items-center gap-1.5`}
            >
              <History size={14} />
              {t("viewBusinessHistory")}
              <LinkPendingSpinner size={10} className="" />
            </Link>
          ) : null}
          {canEdit && !adding && editingId === null ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={`${buttonSecondaryClass} inline-flex items-center gap-1.5`}
            >
              <Plus size={14} />
              {t("addButton")}
            </button>
          ) : null}
        </div>
      </div>

      {people.length === 0 && !adding ? (
        <p className="text-body text-content-muted italic py-2">{t("empty")}</p>
      ) : null}

      {SECTION_ORDER.map((sectionKey) => {
        const list = grouped.get(sectionKey) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={sectionKey} className="space-y-1">
            <h3 className="text-label font-semibold uppercase text-content-muted pt-2">
              {t(`sections.${sectionKey}`)}
            </h3>
            <ul className="divide-y divide-edge-muted border-t border-edge-muted">
              {list.map((row) =>
                editingId === row.id ? (
                  <li key={row.id} className="py-3">
                    <PersonForm
                      businessId={businessId}
                      person={row}
                      linkableUsers={linkableUsers}
                      people={people}
                      onDone={() => setEditingId(null)}
                    />
                  </li>
                ) : (
                  <li key={row.id} className="py-3">
                    <PersonRowView
                      row={row}
                      canEdit={canEdit}
                      businessId={businessId}
                      linkableUsers={linkableUsers}
                      onEdit={() => setEditingId(row.id)}
                    />
                  </li>
                ),
              )}
            </ul>
          </div>
        );
      })}

      {adding ? (
        <div className="pt-3 border-t border-edge-muted">
          <PersonForm
            businessId={businessId}
            person={null}
            linkableUsers={linkableUsers}
            people={people}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────
// Row rendering
// ────────────────────────────────────────────────────────────────

function PersonRowView({
  row,
  canEdit,
  businessId,
  linkableUsers,
  onEdit,
}: {
  row: PersonRow;
  canEdit: boolean;
  businessId: string;
  linkableUsers: LinkableUser[];
  onEdit: () => void;
}): React.JSX.Element {
  const t = useTranslations("business.people");
  const [deleting, setDeleting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const linkedUser = row.user_id
    ? linkableUsers.find((u) => u.user_id === row.user_id)
    : null;

  const displayName = row.preferred_name ?? row.legal_name;
  const comp = formatCompensation(row, t);

  return (
    <div className="flex items-start gap-3 flex-wrap">
      <Avatar name={displayName} />

      <div className="flex-1 min-w-[200px] space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-medium text-content">{displayName}</span>
          {row.preferred_name && row.preferred_name !== row.legal_name ? (
            <span className="text-caption text-content-muted">
              ({row.legal_name})
            </span>
          ) : null}
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium ${EMPLOYMENT_BADGE[row.employment_type]}`}
          >
            {t(`employmentTypes.${row.employment_type}`)}
          </span>
          {linkedUser ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-caption text-content-secondary">
              <Link2 size={10} />
              {linkedUser.display_name ?? linkedUser.email ?? t("linkedUserFallback")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 text-caption text-content-muted">
              <Link2Off size={10} aria-hidden="true" />
              {t("notLinkedLabel")}
            </span>
          )}
        </div>

        <div className="text-caption text-content-muted flex flex-wrap gap-x-3 gap-y-0.5">
          {row.title ? <span>{row.title}</span> : null}
          {row.department ? <span>{row.department}</span> : null}
          {comp ? <span className="font-mono tabular-nums">{comp}</span> : null}
          {row.started_on ? <span>Started {row.started_on}</span> : null}
          {row.ended_on ? <span>Ended {row.ended_on}</span> : null}
        </div>
      </div>

      {canEdit && !deleting ? (
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip label={t("viewHistory")} labelMode="label">
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              className={`${buttonGhostClass} inline-flex items-center gap-1`}
            >
              <History size={14} aria-hidden="true" />
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={onEdit}
            className={`${buttonGhostClass} inline-flex items-center gap-1`}
            aria-label={`Edit ${displayName}`}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className={`${buttonGhostClass} inline-flex items-center gap-1 text-error-text hover:bg-error-soft`}
            aria-label={`Delete ${displayName}`}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {deleting ? (
        <div className="w-full pt-2">
          <InlineDeleteRowConfirm
            summary={t("deleteSummary", { name: displayName })}
            ariaLabel={`Delete ${displayName}`}
            onConfirm={async () => {
              const fd = new FormData();
              fd.set("business_id", businessId);
              fd.set("person_id", row.id);
              await deletePersonAction(fd);
              setDeleting(false);
            }}
          />
        </div>
      ) : null}

      <PersonHistoryDialog
        open={showHistory}
        onClose={() => setShowHistory(false)}
        personId={row.id}
        personDisplayName={displayName}
      />
    </div>
  );
}

function Avatar({ name }: { name: string }): React.JSX.Element {
  const initials = name
    .split(/\s+/)
    .map((s) => s[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text text-caption font-semibold"
    >
      {initials || "?"}
    </div>
  );
}

function formatCompensation(
  row: PersonRow,
  t: (key: string) => string,
): string | null {
  if (row.compensation_amount_cents === null || row.compensation_type === null) {
    return null;
  }
  const currency = row.compensation_currency ?? "USD";
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(row.compensation_amount_cents / 100);
  const schedule = row.compensation_schedule
    ? ` ${t(`compensationSchedules.${row.compensation_schedule}`).toLowerCase()}`
    : "";
  return `${formatted}${schedule}`;
}

// ────────────────────────────────────────────────────────────────
// Create / edit form
// ────────────────────────────────────────────────────────────────

function PersonForm({
  businessId,
  person,
  linkableUsers,
  people,
  onDone,
}: {
  businessId: string;
  person: PersonRow | null;
  linkableUsers: LinkableUser[];
  people: PersonRow[];
  onDone: () => void;
}): React.JSX.Element {
  const t = useTranslations("business.people");
  const tc = useTranslations("common");
  const isEdit = person !== null;

  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: isEdit ? updatePersonAction : createPersonAction,
    onSuccess: onDone,
  });

  const initial =
    person ??
    ({
      user_id: null,
      legal_name: "",
      preferred_name: null,
      work_email: null,
      work_phone: null,
      employment_type: "w2_employee" as const,
      title: null,
      department: null,
      employee_number: null,
      started_on: null,
      ended_on: null,
      compensation_type: null,
      compensation_amount_cents: null,
      compensation_currency: "USD",
      compensation_schedule: null,
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      postal_code: null,
      country: "US",
      reports_to_person_id: null,
      notes: null,
    } satisfies Omit<PersonRow, "id">);

  const compAmountDollars =
    initial.compensation_amount_cents !== null
      ? (initial.compensation_amount_cents / 100).toFixed(2)
      : "";

  // Controlled state for the two date fields. The form is opened
  // afresh per person edit (parent toggles editingId), so initial
  // values seed once on mount.
  const [startedOn, setStartedOn] = useState(initial.started_on ?? "");
  const [endedOn, setEndedOn] = useState(initial.ended_on ?? "");

  const managerCandidates = people.filter(
    (p) => p.id !== person?.id,
  );

  return (
    <form action={handleSubmit} className="space-y-3">
      <input type="hidden" name="business_id" value={businessId} />
      {person ? (
        <input type="hidden" name="person_id" value={person.id} />
      ) : null}

      {serverError ? <AlertBanner tone="error">{serverError}</AlertBanner> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="people-legalName" className={labelClass}>{t("fields.legalName")}</label>
          <input id="people-legalName"
            name="legal_name"
            defaultValue={initial.legal_name}
            required
            autoFocus
            className={inputClass}
          />
          <p className="mt-1 text-caption text-content-muted">
            {t("fields.legalNameHelp")}
          </p>
        </div>

        <div>
          <label htmlFor="people-preferredName" className={labelClass}>{t("fields.preferredName")}</label>
          <input id="people-preferredName"
            name="preferred_name"
            defaultValue={initial.preferred_name ?? ""}
            className={inputClass}
          />
          <p className="mt-1 text-caption text-content-muted">
            {t("fields.preferredNameHelp")}
          </p>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="people-userLink" className={labelClass}>{t("fields.userLink")}</label>
          <select id="people-userLink"
            name="user_id"
            defaultValue={initial.user_id ?? ""}
            className={selectClass}
          >
            <option value="">{t("fields.userLinkNone")}</option>
            {linkableUsers.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.display_name ?? u.email ?? u.user_id.slice(0, 8)}
                {u.email ? ` · ${u.email}` : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-caption text-content-muted">
            {t("fields.userLinkHelp")}
          </p>
        </div>

        <div>
          <label htmlFor="people-employmentType" className={labelClass}>{t("fields.employmentType")}</label>
          <select id="people-employmentType"
            name="employment_type"
            defaultValue={initial.employment_type}
            className={selectClass}
          >
            <option value="w2_employee">{t("employmentTypes.w2_employee")}</option>
            <option value="1099_contractor">
              {t("employmentTypes.1099_contractor")}
            </option>
            <option value="partner">{t("employmentTypes.partner")}</option>
            <option value="owner">{t("employmentTypes.owner")}</option>
            <option value="unpaid">{t("employmentTypes.unpaid")}</option>
          </select>
        </div>

        <div>
          <label htmlFor="people-title" className={labelClass}>{t("fields.title")}</label>
          <input id="people-title"
            name="title"
            defaultValue={initial.title ?? ""}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="people-department" className={labelClass}>{t("fields.department")}</label>
          <input id="people-department"
            name="department"
            defaultValue={initial.department ?? ""}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="people-employeeNumber" className={labelClass}>{t("fields.employeeNumber")}</label>
          <input id="people-employeeNumber"
            name="employee_number"
            defaultValue={initial.employee_number ?? ""}
            className={`${inputClass} font-mono`}
          />
        </div>

        <div>
          <label htmlFor="people-workEmail" className={labelClass}>{t("fields.workEmail")}</label>
          <input id="people-workEmail"
            type="email"
            name="work_email"
            defaultValue={initial.work_email ?? ""}
            className={inputClass}
          />
          <p className="mt-1 text-caption text-content-muted">
            {t("fields.workEmailHelp")}
          </p>
        </div>

        <div>
          <label htmlFor="people-workPhone" className={labelClass}>{t("fields.workPhone")}</label>
          <input id="people-workPhone"
            name="work_phone"
            defaultValue={initial.work_phone ?? ""}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="people-startedOn" className={labelClass}>{t("fields.startedOn")}</label>
          <DateField
            id="people-startedOn"
            name="started_on"
            value={startedOn}
            onChange={setStartedOn}
          />
        </div>

        <div>
          <label htmlFor="people-endedOn" className={labelClass}>{t("fields.endedOn")}</label>
          <DateField
            id="people-endedOn"
            name="ended_on"
            value={endedOn}
            onChange={setEndedOn}
          />
        </div>

        <div>
          <label htmlFor="people-compensationType" className={labelClass}>{t("fields.compensationType")}</label>
          <select id="people-compensationType"
            name="compensation_type"
            defaultValue={initial.compensation_type ?? ""}
            className={selectClass}
          >
            <option value="">—</option>
            <option value="salary">{t("compensationTypes.salary")}</option>
            <option value="hourly">{t("compensationTypes.hourly")}</option>
            <option value="project_based">
              {t("compensationTypes.project_based")}
            </option>
            <option value="equity_only">
              {t("compensationTypes.equity_only")}
            </option>
            <option value="unpaid">{t("compensationTypes.unpaid")}</option>
          </select>
        </div>

        <div>
          <label htmlFor="people-compensationSchedule" className={labelClass}>{t("fields.compensationSchedule")}</label>
          <select id="people-compensationSchedule"
            name="compensation_schedule"
            defaultValue={initial.compensation_schedule ?? ""}
            className={selectClass}
          >
            <option value="">—</option>
            <option value="annual">{t("compensationSchedules.annual")}</option>
            <option value="monthly">{t("compensationSchedules.monthly")}</option>
            <option value="biweekly">{t("compensationSchedules.biweekly")}</option>
            <option value="weekly">{t("compensationSchedules.weekly")}</option>
            <option value="per_hour">{t("compensationSchedules.per_hour")}</option>
            <option value="per_project">
              {t("compensationSchedules.per_project")}
            </option>
          </select>
        </div>

        <div>
          <label htmlFor="people-compensationAmount" className={labelClass}>{t("fields.compensationAmount")}</label>
          <input id="people-compensationAmount"
            type="number"
            name="compensation_amount"
            min={0}
            step="0.01"
            defaultValue={compAmountDollars}
            className={`${inputClass} font-mono`}
          />
        </div>

        <div>
          <label htmlFor="people-compensationCurrency" className={labelClass}>{t("fields.compensationCurrency")}</label>
          <input id="people-compensationCurrency"
            name="compensation_currency"
            defaultValue={initial.compensation_currency ?? "USD"}
            maxLength={3}
            className={`${inputClass} font-mono uppercase`}
          />
        </div>

        <div className="sm:col-span-2 pt-2">
          <label htmlFor="people-reportsTo" className={labelClass}>{t("fields.reportsTo")}</label>
          <select id="people-reportsTo"
            name="reports_to_person_id"
            defaultValue={initial.reports_to_person_id ?? ""}
            className={selectClass}
          >
            <option value="">{t("fields.reportsToNone")}</option>
            {managerCandidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.preferred_name ?? m.legal_name}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2 pt-2">
          <div className="text-label font-semibold uppercase text-content-muted mb-2">
            {t("mailingAddress")}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="people-addressLine1" className={labelClass}>{t("fields.addressLine1")}</label>
              <input id="people-addressLine1"
                name="address_line1"
                defaultValue={initial.address_line1 ?? ""}
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="people-addressLine2" className={labelClass}>{t("fields.addressLine2")}</label>
              <input id="people-addressLine2"
                name="address_line2"
                defaultValue={initial.address_line2 ?? ""}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="people-city" className={labelClass}>{t("fields.city")}</label>
              <input id="people-city"
                name="city"
                defaultValue={initial.city ?? ""}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="people-state" className={labelClass}>{t("fields.state")}</label>
              <input id="people-state"
                name="state"
                defaultValue={initial.state ?? ""}
                maxLength={2}
                className={`${inputClass} font-mono uppercase`}
              />
            </div>
            <div>
              <label htmlFor="people-postalCode" className={labelClass}>{t("fields.postalCode")}</label>
              <input id="people-postalCode"
                name="postal_code"
                defaultValue={initial.postal_code ?? ""}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="people-country" className={labelClass}>{t("fields.country")}</label>
              <input id="people-country"
                name="country"
                defaultValue={initial.country ?? "US"}
                maxLength={2}
                className={`${inputClass} font-mono uppercase`}
              />
            </div>
          </div>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="people-notes" className={labelClass}>{t("fields.notes")}</label>
          <input id="people-notes"
            name="notes"
            defaultValue={initial.notes ?? ""}
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <SubmitButton
          label={t("save")}
          pending={pending}
          success={success}
          successMessage={tc("actions.saved")}
          className={buttonPrimaryClass}
        />
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className={buttonGhostClass}
        >
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
