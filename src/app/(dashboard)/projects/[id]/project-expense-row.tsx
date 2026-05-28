"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Trash2,
  Check,
  X,
  ExternalLink,
  BadgeDollarSign,
  CircleSlash,
  FileText,
} from "lucide-react";
import { Spinner, Avatar, resolveAvatarUrl } from "@theshyre/ui";
import { Tooltip } from "@/components/Tooltip";
import { useFormAction } from "@/hooks/use-form-action";
import { useToast } from "@/components/Toast";
import {
  deleteExpenseAction,
  restoreExpenseAction,
} from "@/app/(dashboard)/business/[businessId]/expenses/actions";
import {
  formatExpenseAmount,
  formatExpenseDateDisplay,
} from "@/app/(dashboard)/business/[businessId]/expenses/format-helpers";

export interface ProjectExpenseRowExpense {
  id: string;
  incurred_on: string;
  amount: number;
  currency: string;
  vendor: string | null;
  category: string;
  billable: boolean;
  /** Phase 2: present when the expense has landed on an invoice.
   *  When set, the row renders an "Invoiced #INV-…" chip (link to
   *  /invoices/<id>) and the delete affordance is hidden — the row
   *  is locked at the action layer too, mirrored here so the UI
   *  doesn't promise something the server denies. */
  invoiced: boolean;
  invoiceId: string | null;
  invoiceNumber: string | null;
}

export interface ProjectExpenseRowAuthor {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface Props {
  expense: ProjectExpenseRowExpense;
  /** Submitter — per the time-entry-authorship rule, every row that
   *  surfaces an expense renders who logged it. Null only when the
   *  user_profiles row went missing (defensive — shouldn't happen
   *  under normal data). */
  author: ProjectExpenseRowAuthor | null;
  /** True when the viewer authored this row OR is owner|admin on
   *  its team. Hides the delete button when false. Cell-level edit
   *  is intentionally absent on this surface — the deep-link below
   *  is the only edit path on the project page. */
  canEdit: boolean;
  /** Business id of the project's team — used to build the deep-
   *  link to the main expenses page (`/business/<id>/expenses?
   *  project=<projectId>`). Resolved server-side in the section
   *  component so the row stays free of any DB lookup. */
  businessId: string;
  /** Project id — the deep-link prefilters the main expenses page
   *  by this project so the user lands on the focused list. */
  projectId: string;
}

export function ProjectExpenseRow({
  expense,
  author,
  canEdit,
  businessId,
  projectId,
}: Props): React.JSX.Element {
  const t = useTranslations("projects.expenses");
  const te = useTranslations("expenses");
  const tc = useTranslations("common");
  const toast = useToast();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Focus refs — when the row swaps the Trash icon for the inline
  // Confirm/Cancel form, the button that had focus is unmounted and
  // the browser drops focus to <body>. Both moves explicitly: into
  // Confirm on enter, back to Trash on cancel / restore from undo.
  const trashRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (confirmingDelete) {
      confirmRef.current?.focus();
    }
  }, [confirmingDelete]);

  const ariaIdent = expense.vendor ?? te(`categories.${expense.category}`);
  // Falls back to a localized "Unknown user" when a profile row is
  // missing — a UUID slice would be read aloud as gibberish.
  const authorLabel = author?.displayName ?? t("unknownAuthor");

  const del = useFormAction({
    action: deleteExpenseAction,
    onSuccess: () => {
      setConfirmingDelete(false);
      toast.push({
        kind: "info",
        message: t("deletedToast"),
        actionLabel: t("undo"),
        durationMs: 10_000,
        onAction: async () => {
          const fd = new FormData();
          fd.set("id", expense.id);
          await restoreExpenseAction(fd);
        },
      });
    },
  });

  function cancelConfirm(): void {
    setConfirmingDelete(false);
    // Return focus to the trash trigger — the form just unmounted
    // from the row so without this the user is left on <body>.
    queueMicrotask(() => trashRef.current?.focus());
  }

  const deepLinkHref =
    `/business/${businessId}/expenses?project=${encodeURIComponent(projectId)}`;

  return (
    <tr className="border-b border-edge last:border-0 hover:bg-hover transition-colors">
      <td className="px-4 py-3 text-content-secondary tabular-nums">
        {formatExpenseDateDisplay(expense.incurred_on)}
      </td>

      <td className="px-4 py-3">
        {author ? (
          <span className="inline-flex items-center gap-1.5">
            <Avatar
              avatarUrl={resolveAvatarUrl(author.avatarUrl, author.userId)}
              displayName={author.displayName ?? ""}
              size={20}
            />
            <span className="text-content-secondary truncate">
              {authorLabel}
            </span>
          </span>
        ) : (
          <span className="text-content-muted">—</span>
        )}
      </td>

      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium ${
            expense.category === "other"
              ? "bg-warning-soft text-warning-text"
              : "bg-surface-inset text-content-secondary"
          }`}
        >
          {te(`categories.${expense.category}`)}
        </span>
      </td>

      <td className="px-4 py-3 text-content-secondary truncate">
        {expense.vendor ?? <span className="text-content-muted">—</span>}
      </td>

      <td className="px-4 py-3 text-right tabular-nums text-content font-mono">
        {formatExpenseAmount(expense.amount, expense.currency)}
      </td>

      <td className="px-4 py-3">
        {expense.billable ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-label font-semibold uppercase tracking-wider text-success-text">
            <BadgeDollarSign size={12} aria-hidden="true" />
            {t("billableBadge")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-content-muted text-caption">
            <CircleSlash size={12} aria-hidden="true" />
            {t("notBillable")}
          </span>
        )}
      </td>

      <td className="px-4 py-3 text-right">
        <div className="inline-flex items-center gap-1">
          {expense.invoiced && expense.invoiceId ? (
            // Locked: the row is on an invoice. The chip links
            // straight to the invoice instead of the main expenses
            // page so the user lands where the writeback happened.
            // Delete + edit affordances are suppressed because the
            // action layer rejects mutations on invoiced rows.
            <Tooltip
              label={t("invoicedTooltip", {
                number: expense.invoiceNumber ?? "",
              })}
              labelMode="label"
            >
              <Link
                href={`/invoices/${expense.invoiceId}`}
                className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-label font-semibold uppercase tracking-wider text-accent-text hover:opacity-90"
                aria-label={t("invoicedTooltip", {
                  number: expense.invoiceNumber ?? "",
                })}
              >
                <FileText size={12} aria-hidden="true" />
                {expense.invoiceNumber
                  ? t("invoicedBadge", { number: expense.invoiceNumber })
                  : t("invoicedBadgeUnknown")}
              </Link>
            </Tooltip>
          ) : (
            <Tooltip
              label={t("editOnMainAria", { vendor: ariaIdent })}
              labelMode="label"
            >
              <Link
                href={deepLinkHref}
                className="inline-flex items-center gap-1 rounded-md p-1.5 text-content-secondary hover:bg-hover hover:text-content"
                aria-label={t("editOnMainAria", { vendor: ariaIdent })}
              >
                <ExternalLink size={14} aria-hidden="true" />
              </Link>
            </Tooltip>
          )}
          {canEdit && !expense.invoiced && (
            confirmingDelete ? (
              <form
                action={del.handleSubmit}
                className="inline-flex items-center gap-1"
              >
                <input type="hidden" name="id" value={expense.id} />
                <Tooltip label={t("confirmDelete")} labelMode="label">
                  <button
                    ref={confirmRef}
                    type="submit"
                    disabled={del.pending}
                    className="inline-flex items-center gap-1 rounded-md bg-error px-2 py-1 text-caption font-medium text-content-inverse hover:opacity-90 disabled:opacity-50 transition-opacity"
                    aria-label={t("confirmDelete")}
                  >
                    {del.pending ? (
                      <Spinner size="h-3 w-3" />
                    ) : (
                      <Check size={14} aria-hidden="true" />
                    )}
                  </button>
                </Tooltip>
                <Tooltip label={tc("actions.cancel")} labelMode="label">
                  <button
                    type="button"
                    onClick={cancelConfirm}
                    disabled={del.pending}
                    className="inline-flex items-center rounded-md p-1.5 text-content-muted hover:bg-hover"
                    aria-label={tc("actions.cancel")}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </Tooltip>
              </form>
            ) : (
              <Tooltip
                label={t("ariaDelete", { vendor: ariaIdent })}
                labelMode="label"
              >
                <button
                  ref={trashRef}
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="inline-flex items-center rounded-md p-1.5 text-content-secondary hover:bg-hover hover:text-error"
                  aria-label={t("ariaDelete", { vendor: ariaIdent })}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </Tooltip>
            )
          )}
        </div>
      </td>
    </tr>
  );
}
