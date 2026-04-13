"use client";

import { useTranslations } from "next-intl";
import { Send, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useFormAction } from "@/hooks/use-form-action";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { updateInvoiceStatusAction } from "../actions";

interface InvoiceActionsProps {
  invoiceId: string;
  currentStatus: string;
}

export function InvoiceActions({
  invoiceId,
  currentStatus,
}: InvoiceActionsProps): React.JSX.Element {
  const t = useTranslations("invoices.actions");

  const actions = getAvailableActions(currentStatus);

  return (
    <div className="flex gap-2">
      {actions.map((action) => (
        <InvoiceActionButton
          key={action.status}
          invoiceId={invoiceId}
          action={action}
          label={t(action.labelKey)}
        />
      ))}
    </div>
  );
}

function InvoiceActionButton({
  invoiceId,
  action,
  label,
}: {
  invoiceId: string;
  action: ActionConfig;
  label: string;
}): React.JSX.Element {
  const { pending, serverError, handleSubmit } = useFormAction({
    action: updateInvoiceStatusAction,
  });

  const Icon = action.icon;

  return (
    <form action={handleSubmit}>
      <input type="hidden" name="id" value={invoiceId} />
      <input type="hidden" name="status" value={action.status} />
      {serverError && (
        <p className="mb-1 text-xs text-error">{serverError}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className={buttonSecondaryClass}
        onClick={(e) => {
          if (action.status === "void") {
            if (!confirm("Void this invoice? This cannot be undone.")) {
              e.preventDefault();
            }
          }
        }}
      >
        {pending ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Icon size={16} />
        )}
        {label}
      </button>
    </form>
  );
}

interface ActionConfig {
  status: string;
  labelKey: string;
  icon: typeof Send;
}

function getAvailableActions(currentStatus: string): ActionConfig[] {
  switch (currentStatus) {
    case "draft":
      return [
        { status: "sent", labelKey: "markSent", icon: Send },
        { status: "void", labelKey: "markVoid", icon: XCircle },
      ];
    case "sent":
      return [
        { status: "paid", labelKey: "markPaid", icon: CheckCircle },
        { status: "void", labelKey: "markVoid", icon: XCircle },
      ];
    case "overdue":
      return [
        { status: "paid", labelKey: "markPaid", icon: CheckCircle },
        { status: "void", labelKey: "markVoid", icon: XCircle },
      ];
    default:
      return [];
  }
}
