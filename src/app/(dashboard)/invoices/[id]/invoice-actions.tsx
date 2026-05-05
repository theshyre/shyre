"use client";

import { useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Send, CheckCircle, XCircle, AlertTriangle, Trash2, X } from "lucide-react";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  buttonSecondaryClass,
  inputClass,
} from "@/lib/form-styles";
import { allowedNextStatuses, type InvoiceStatus } from "@/lib/invoice-status";
import { updateInvoiceStatusAction, deleteInvoiceAction } from "../actions";

interface InvoiceActionsProps {
  invoiceId: string;
  currentStatus: string;
  /** Visible label for the invoice (its number) — used as the
   *  typed-confirm word when voiding so the user has to recognize
   *  *which* invoice they're killing. */
  invoiceNumber: string;
}

const ACTION_META: Record<
  InvoiceStatus,
  { labelKey: string; icon: typeof Send; tone: "primary" | "danger" } | null
> = {
  draft: null,
  sent: { labelKey: "markSent", icon: Send, tone: "primary" },
  paid: { labelKey: "markPaid", icon: CheckCircle, tone: "primary" },
  void: { labelKey: "markVoid", icon: XCircle, tone: "danger" },
  overdue: { labelKey: "markOverdue", icon: AlertTriangle, tone: "primary" },
};

/** Status-mutation buttons. Drives off the transition graph in
 *  `@/lib/invoice-status` so the buttons can never offer a transition
 *  the server would reject. Voiding uses an inline typed-confirm
 *  (type the invoice number to arm) per CLAUDE.md "Destructive
 *  confirmation flows". */
export function InvoiceActions({
  invoiceId,
  currentStatus,
  invoiceNumber,
}: InvoiceActionsProps): React.JSX.Element {
  const t = useTranslations("invoices.actions");
  const next = allowedNextStatuses(currentStatus);

  return (
    <div className="flex gap-2 flex-wrap">
      {next.map((status) => {
        const meta = ACTION_META[status];
        if (!meta) return null;
        return meta.tone === "danger" ? (
          <VoidButton
            key={status}
            invoiceId={invoiceId}
            invoiceNumber={invoiceNumber}
            label={t(meta.labelKey)}
          />
        ) : (
          <StatusButton
            key={status}
            invoiceId={invoiceId}
            status={status}
            label={t(meta.labelKey)}
            Icon={meta.icon}
          />
        );
      })}
      {/* Hard-delete is only ever offered on a void invoice — voiding
          is the canonical "I don't want this on the record" action,
          and delete is the rarer cleanup pass. The DB action also
          enforces this server-side. */}
      {currentStatus === "void" && (
        <DeleteButton
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          label={t("deleteInvoice")}
        />
      )}
    </div>
  );
}

function StatusButton({
  invoiceId,
  status,
  label,
  Icon,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  label: string;
  Icon: typeof Send;
}): React.JSX.Element {
  const tc = useTranslations("common");
  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: updateInvoiceStatusAction,
  });

  return (
    <form action={handleSubmit} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={invoiceId} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton
        label={label}
        pending={pending}
        success={success}
        successMessage={tc("actions.saved")}
        icon={Icon}
        className={buttonSecondaryClass}
      />
      {serverError && (
        <p className="text-caption text-error">{serverError}</p>
      )}
    </form>
  );
}

function VoidButton({
  invoiceId,
  invoiceNumber,
  label,
}: {
  invoiceId: string;
  invoiceNumber: string;
  label: string;
}): React.JSX.Element {
  const t = useTranslations("invoices.actions");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const armed = typed.trim().toLowerCase() === invoiceNumber.toLowerCase();

  async function fire(): Promise<void> {
    if (!armed || pending) return;
    setPending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("id", invoiceId);
      fd.set("status", "void");
      await updateInvoiceStatusAction(fd);
      setOpen(false);
      setTyped("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter" && armed && !pending) {
      e.preventDefault();
      void fire();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setTyped("");
      setError(null);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={`${buttonSecondaryClass} text-error-text border-error/40 hover:bg-error-soft`}
      >
        <XCircle size={16} />
        {label}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        role="group"
        aria-label={label}
        className="inline-flex items-center gap-2 rounded-md border border-error/40 bg-error-soft px-2 py-1.5"
      >
        <span className="text-caption text-content whitespace-nowrap">
          {t("voidPrompt", { number: invoiceNumber })}
        </span>
        <input
          autoFocus
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={onKey}
          aria-label={t("voidConfirmInputLabel", { number: invoiceNumber })}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={`${inputClass} w-32 font-mono`}
        />
        <button
          type="button"
          onClick={() => void fire()}
          disabled={!armed || pending}
          aria-label={t("voidConfirm")}
          className="inline-flex items-center gap-1 rounded bg-error px-2 py-1 text-caption font-semibold text-content-inverse hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          <XCircle size={12} />
          {t("voidConfirm")}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
          disabled={pending}
          aria-label={tc("actions.cancel")}
          className="rounded p-1 text-content-muted hover:bg-hover transition-colors"
        >
          <X size={12} />
        </button>
      </div>
      {error && <p className="text-caption text-error">{error}</p>}
    </div>
  );
}

/**
 * Hard-delete a void invoice. Same typed-confirm pattern as
 * VoidButton — typing the invoice number arms the destructive
 * action so it's not a single-click mistake. Server enforces the
 * "must be void" precondition independently; the UI only renders
 * the button when status === 'void' to keep it out of sight on
 * normal invoices.
 */
function DeleteButton({
  invoiceId,
  invoiceNumber,
  label,
}: {
  invoiceId: string;
  invoiceNumber: string;
  label: string;
}): React.JSX.Element {
  const t = useTranslations("invoices.actions");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const armed = typed.trim().toLowerCase() === invoiceNumber.toLowerCase();

  async function fire(): Promise<void> {
    if (!armed || pending) return;
    setPending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("id", invoiceId);
      // runSafeAction returns { success, error } shape — we have to
      // read it explicitly, not assume a thrown rejection.
      const result = (await deleteInvoiceAction(fd)) as unknown as
        | { success: boolean; error?: { message: string } }
        | void;
      if (
        result &&
        (result as { success: boolean }).success === false
      ) {
        throw new Error(
          (result as { error?: { message: string } }).error?.message ??
            "Delete failed",
        );
      }
      // Navigate out — the invoice no longer exists.
      router.push("/invoices");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter" && armed && !pending) {
      e.preventDefault();
      void fire();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setTyped("");
      setError(null);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={`${buttonSecondaryClass} text-error-text border-error/40 hover:bg-error-soft`}
      >
        <Trash2 size={16} />
        {label}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        role="group"
        aria-label={label}
        className="inline-flex items-center gap-2 rounded-md border border-error/40 bg-error-soft px-2 py-1.5"
      >
        <span className="text-caption text-content whitespace-nowrap">
          {t("deletePrompt", { number: invoiceNumber })}
        </span>
        <input
          autoFocus
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={onKey}
          aria-label={t("deleteConfirmInputLabel", { number: invoiceNumber })}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={`${inputClass} w-32 font-mono`}
        />
        <button
          type="button"
          onClick={() => void fire()}
          disabled={!armed || pending}
          aria-label={t("deleteConfirm")}
          className="inline-flex items-center gap-1 rounded bg-error px-2 py-1 text-caption font-semibold text-content-inverse hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          <Trash2 size={12} />
          {t("deleteConfirm")}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
          disabled={pending}
          aria-label={tc("actions.cancel")}
          className="rounded p-1 text-content-muted hover:bg-hover transition-colors"
        >
          <X size={12} />
        </button>
      </div>
      {error && <p className="text-caption text-error">{error}</p>}
    </div>
  );
}
