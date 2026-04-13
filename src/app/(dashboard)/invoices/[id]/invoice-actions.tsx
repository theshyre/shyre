"use client";

import { useTranslations } from "next-intl";
import { Send, CheckCircle, XCircle } from "lucide-react";
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
        <form key={action.status} action={updateInvoiceStatusAction}>
          <input type="hidden" name="id" value={invoiceId} />
          <input type="hidden" name="status" value={action.status} />
          <button
            type="submit"
            className={buttonSecondaryClass}
            onClick={(e) => {
              if (action.status === "void") {
                if (!confirm("Void this invoice? This cannot be undone.")) {
                  e.preventDefault();
                }
              }
            }}
          >
            <action.icon size={16} />
            {t(action.labelKey)}
          </button>
        </form>
      ))}
    </div>
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
