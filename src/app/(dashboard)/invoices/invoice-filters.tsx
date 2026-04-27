"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Filter, X } from "lucide-react";
import {
  inputClass,
  selectClass,
  labelClass,
  buttonGhostClass,
  buttonPrimaryClass,
} from "@/lib/form-styles";
import { INVOICE_STATUSES } from "@/lib/invoice-status";

interface CustomerOption {
  id: string;
  name: string;
}

interface Props {
  selectedTeamId: string | null;
  customers: CustomerOption[];
  currentFilters: {
    status: string | null;
    customerId: string | null;
    from: string | null;
    to: string | null;
  };
}

/** Filter pill for the invoice list. URL-driven so filters survive
 *  reload + back. Submitting pushes a new query string and the page
 *  re-renders with filtered data. */
export function InvoiceFilters({
  selectedTeamId,
  customers,
  currentFilters,
}: Props): React.JSX.Element {
  const t = useTranslations("invoices.filters");
  const tStatus = useTranslations("invoices.status");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState(currentFilters.status ?? "");
  const [customerId, setCustomerId] = useState(
    currentFilters.customerId ?? "",
  );
  const [from, setFrom] = useState(currentFilters.from ?? "");
  const [to, setTo] = useState(currentFilters.to ?? "");

  const hasAny =
    !!currentFilters.status ||
    !!currentFilters.customerId ||
    !!currentFilters.from ||
    !!currentFilters.to;

  function apply(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    setOrDelete(params, "status", status);
    setOrDelete(params, "customerId", customerId);
    setOrDelete(params, "from", from);
    setOrDelete(params, "to", to);
    if (selectedTeamId) params.set("org", selectedTeamId);
    router.push(`/invoices${params.toString() ? `?${params.toString()}` : ""}`);
  }

  function clear(): void {
    setStatus("");
    setCustomerId("");
    setFrom("");
    setTo("");
    const params = new URLSearchParams();
    if (selectedTeamId) params.set("org", selectedTeamId);
    router.push(`/invoices${params.toString() ? `?${params.toString()}` : ""}`);
  }

  return (
    <form
      onSubmit={apply}
      className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3"
    >
      <div className="flex items-center gap-2 text-label font-semibold uppercase tracking-wider text-content-muted">
        <Filter size={12} />
        {t("heading")}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className={labelClass} htmlFor="if-status">
            {t("status")}
          </label>
          <select
            id="if-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={selectClass}
          >
            <option value="">{t("anyStatus")}</option>
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="if-customer">
            {t("customer")}
          </label>
          <select
            id="if-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={selectClass}
          >
            <option value="">{t("anyCustomer")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="if-from">
            {t("from")}
          </label>
          <input
            id="if-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="if-to">
            {t("to")}
          </label>
          <input
            id="if-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button type="submit" className={buttonPrimaryClass}>
          {t("apply")}
        </button>
        {hasAny && (
          <button
            type="button"
            onClick={clear}
            className={`${buttonGhostClass} inline-flex items-center gap-1.5`}
          >
            <X size={12} />
            {t("clear")}
          </button>
        )}
      </div>
    </form>
  );
}

function setOrDelete(
  params: URLSearchParams,
  key: string,
  value: string,
): void {
  const trimmed = value.trim();
  if (trimmed) {
    params.set(key, trimmed);
  } else {
    params.delete(key);
  }
}
