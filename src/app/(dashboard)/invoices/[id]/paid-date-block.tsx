"use client";

import { useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle, Pencil, X } from "lucide-react";
import { DateField } from "@/components/DateField";
import { Tooltip } from "@/components/Tooltip";
import { FieldError } from "@/components/FieldError";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
} from "@/lib/form-styles";
import { InvoiceStatusBadge } from "../invoice-status-badge";
import { editInvoicePaidDateAction } from "../actions";

const MONTH_ABBREV = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Format the UTC-date component of a paid_at ISO string as
 * "MMM D, YYYY". `paid_at` is stored as midnight UTC of the
 * paid day — feeding it through `formatDate` (which is
 * `Date.toLocaleDateString`) shifts the visible day backward
 * in negative-offset timezones (Pacific: May 8 UTC → May 7).
 * The UTC date IS the user-meant date, so extract it from the
 * string directly.
 */
function formatPaidDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const month = MONTH_ABBREV[Number(mo) - 1] ?? mo;
  return `${month} ${Number(d)}, ${y}`;
}

interface Props {
  invoiceId: string;
  /** ISO timestamp from invoices.paid_at, or null on an invoice that
   *  was somehow marked paid without a stamp (legacy data). */
  paidAt: string | null;
  /** YYYY-MM-DD; used by the RPC's `paid_on >= issued_date` rule, and
   *  also as the DateField `min` so the picker never offers an invalid
   *  date. */
  issuedDate: string | null;
  /** Number of invoice_payments rows for this invoice. Drives the
   *  multi-payment disabled-pencil branch — there's no payments-edit
   *  UI yet, so 2+ payments means the user can't correct via this
   *  flow. */
  paymentCount: number;
}

/**
 * Renders the prominent Paid badge alongside the paid date and a
 * pencil-icon edit affordance. Click → inline-expansion form
 * (sibling row below the header) with a DateField + Reason textarea.
 *
 * Owner/admin enforcement is done server-side in the RPC — the
 * pencil renders for everyone; a non-admin click fails with a
 * friendly error. Consistent with the existing InvoiceActions
 * pattern (buttons always render; server enforces role).
 *
 * Multi-payment case (>=2 rows): pencil renders disabled with a
 * tooltip pointing the user at the payments section of the activity
 * log. The RPC also rejects this case independently.
 */
export function PaidDateBlock({
  invoiceId,
  paidAt,
  issuedDate,
  paymentCount,
}: Props): React.JSX.Element {
  const t = useTranslations("invoices.paidDate");
  const tc = useTranslations("common");
  const router = useRouter();

  const currentIso = paidAt ? paidAt.slice(0, 10) : "";

  const [open, setOpen] = useState(false);
  const [newPaidOn, setNewPaidOn] = useState<string>(currentIso);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const multiPayment = paymentCount >= 2;
  const reasonOk = reason.trim().length >= 10;
  const armed = !pending && newPaidOn !== "" && reasonOk;

  async function fire(): Promise<void> {
    if (!armed) return;
    setPending(true);
    setError(null);
    try {
      const f = new FormData();
      f.set("invoice_id", invoiceId);
      f.set("new_paid_on", newPaidOn);
      f.set("reason", reason.trim());
      const result = (await editInvoicePaidDateAction(f)) as unknown as
        | { success: boolean; error?: { message: string } }
        | void;
      if (
        result &&
        (result as { success: boolean }).success === false
      ) {
        throw new Error(
          (result as { error?: { message: string } }).error?.message ??
            t("saveFailed"),
        );
      }
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  function onAnyKey(e: KeyboardEvent<HTMLElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && armed) {
      e.preventDefault();
      void fire();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setError(null);
    }
  }

  const formattedDate = paidAt ? formatPaidDate(paidAt) : t("unknownDate");

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <InvoiceStatusBadge status="paid" size="prominent" />
        <span className="text-body text-content-secondary">
          {t("on")}{" "}
          <span className="font-medium text-content">{formattedDate}</span>
        </span>
        {multiPayment ? (
          <Tooltip label={t("multiPaymentTooltip", { count: paymentCount })}>
            <button
              type="button"
              disabled
              aria-label={t("editAriaLabel")}
              className={`${buttonSecondaryClass} opacity-50 cursor-not-allowed`}
            >
              <Pencil size={14} />
              {t("editButton")}
            </button>
          </Tooltip>
        ) : (
          <Tooltip label={t("editTooltip")}>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setNewPaidOn(currentIso);
                setReason("");
                setOpen((v) => !v);
              }}
              aria-label={t("editAriaLabel")}
              aria-expanded={open}
              className={buttonSecondaryClass}
            >
              <Pencil size={14} />
              {t("editButton")}
            </button>
          </Tooltip>
        )}
      </div>

      {open && (
        <div
          className="flex flex-col gap-3 rounded-md border border-edge bg-surface-raised p-4 max-w-[480px]"
          onKeyDown={onAnyKey}
          role="group"
          aria-label={t("formAriaLabel")}
        >
          <h3 className="text-label font-semibold uppercase tracking-wider text-content-muted">
            {t("formTitle")}
          </h3>

          <label className="flex flex-col gap-1">
            <span className="text-caption text-content-secondary">
              {t("dateLabel")}
            </span>
            <DateField
              value={newPaidOn}
              onChange={setNewPaidOn}
              min={issuedDate ?? undefined}
              ariaLabel={t("dateLabel")}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-caption text-content-secondary">
              {t("reasonLabel")}
            </span>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              rows={3}
              maxLength={500}
              aria-label={t("reasonLabel")}
              aria-describedby={
                reason.length > 0 && !reasonOk
                  ? `reason-hint-${invoiceId}`
                  : undefined
              }
              className={`${inputClass} resize-y`}
            />
            {reason.length > 0 && !reasonOk && (
              <span
                id={`reason-hint-${invoiceId}`}
                className="text-caption text-content-muted"
              >
                {t("reasonMin", { min: 10, current: reason.trim().length })}
              </span>
            )}
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fire()}
              disabled={!armed}
              aria-label={t("saveButton")}
              className={buttonPrimaryClass}
            >
              <CheckCircle size={16} />
              {pending ? `${t("saveButton")}…` : t("saveButton")}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={pending}
              aria-label={tc("actions.cancel")}
              className={buttonSecondaryClass}
            >
              <X size={14} />
              {tc("actions.cancel")}
            </button>
          </div>

          <FieldError error={error} />
        </div>
      )}
    </div>
  );
}
