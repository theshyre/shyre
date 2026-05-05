"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Briefcase, RefreshCw } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  buttonSecondaryClass,
  buttonDangerClass,
  labelClass,
  selectClass,
} from "@/lib/form-styles";
import {
  setProjectInternalAction,
  applyDefaultBillableAction,
} from "../actions";

interface CustomerOption {
  id: string;
  name: string;
}

/**
 * Pair-toggle for internal vs client-work classification, plus the
 * bulk "apply default billable to existing unbilled entries" action.
 *
 * These three operations live outside the regular edit form because
 * they each touch shared invariants (the CHECK constraint between
 * is_internal and customer_id; bulk row updates) that the edit-form
 * patch shape doesn't model. Surfacing them as discrete buttons with
 * inline confirmation keeps the consequence visible — click ≠ accidental.
 */
export function ProjectClassification({
  projectId,
  isInternal,
  defaultBillable,
  currentCustomerId,
  customers,
}: {
  projectId: string;
  isInternal: boolean;
  defaultBillable: boolean;
  currentCustomerId: string | null;
  customers: CustomerOption[];
}): React.JSX.Element {
  const t = useTranslations("projects");
  const tc = useTranslations("common");

  // Three primary actions, mutually exclusive in the UI: convert to
  // internal, convert to client work, apply billable default to
  // existing entries. Each opens its own inline confirm panel.
  const [openPanel, setOpenPanel] = useState<
    null | "to_internal" | "to_client" | "apply_billable"
  >(null);

  const closePanel = (): void => setOpenPanel(null);

  const flipForm = useFormAction({
    action: setProjectInternalAction,
    onSuccess: closePanel,
  });
  const billableForm = useFormAction({
    action: applyDefaultBillableAction,
    onSuccess: closePanel,
  });

  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-4">
      <h2 className="text-body-lg font-semibold text-content">
        {t("classification.heading")}
      </h2>
      <p className="mt-1 text-caption text-content-muted">
        {isInternal
          ? t("classification.internalDescription")
          : t("classification.externalDescription")}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {isInternal ? (
          <button
            type="button"
            className={buttonSecondaryClass}
            onClick={() =>
              setOpenPanel(openPanel === "to_client" ? null : "to_client")
            }
          >
            <Briefcase size={14} />
            {t("classification.makeClientWork")}
          </button>
        ) : (
          <button
            type="button"
            className={buttonSecondaryClass}
            onClick={() =>
              setOpenPanel(openPanel === "to_internal" ? null : "to_internal")
            }
          >
            <Building2 size={14} />
            {t("classification.makeInternal")}
          </button>
        )}

        <button
          type="button"
          className={buttonSecondaryClass}
          onClick={() =>
            setOpenPanel(openPanel === "apply_billable" ? null : "apply_billable")
          }
        >
          <RefreshCw size={14} />
          {t("classification.applyDefaultBillable")}
        </button>
      </div>

      {openPanel === "to_internal" && (
        // Confirm: making this internal is reversible (you can flip
        // back) but it nulls customer_id and sets default_billable to
        // false — a meaningful state change that deserves a beat of
        // friction.
        <form
          action={flipForm.handleSubmit}
          className="mt-3 rounded-md border border-edge bg-surface-inset p-3 space-y-2"
        >
          <input type="hidden" name="id" value={projectId} />
          <input type="hidden" name="target" value="internal" />
          {flipForm.serverError && (
            <AlertBanner tone="error">{flipForm.serverError}</AlertBanner>
          )}
          <p className="text-body-lg text-content">
            {t("classification.confirmMakeInternal")}
          </p>
          <ul className="ml-4 list-disc text-caption text-content-muted">
            <li>{t("classification.makeInternalEffect.customer")}</li>
            <li>{t("classification.makeInternalEffect.billable")}</li>
            <li>{t("classification.makeInternalEffect.invoices")}</li>
          </ul>
          <div className="flex gap-2">
            <SubmitButton
              label={t("classification.makeInternal")}
              pending={flipForm.pending}
              success={flipForm.success}
              successMessage={tc("actions.saved")}
            />
            <button
              type="button"
              disabled={flipForm.pending}
              onClick={closePanel}
              className={buttonSecondaryClass}
            >
              {tc("actions.cancel")}
            </button>
          </div>
        </form>
      )}

      {openPanel === "to_client" && (
        <form
          action={flipForm.handleSubmit}
          className="mt-3 rounded-md border border-edge bg-surface-inset p-3 space-y-2"
        >
          <input type="hidden" name="id" value={projectId} />
          <input type="hidden" name="target" value="client_work" />
          {flipForm.serverError && (
            <AlertBanner tone="error">{flipForm.serverError}</AlertBanner>
          )}
          <p className="text-body-lg text-content">
            {t("classification.confirmMakeClient")}
          </p>
          <div>
            <label className={labelClass}>{t("fields.customer")} *</label>
            <select
              name="customer_id"
              required
              defaultValue={currentCustomerId ?? ""}
              className={selectClass}
            >
              <option value="">{t("fields.pickCustomer")}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <SubmitButton
              label={t("classification.makeClientWork")}
              pending={flipForm.pending}
              success={flipForm.success}
              successMessage={tc("actions.saved")}
            />
            <button
              type="button"
              disabled={flipForm.pending}
              onClick={closePanel}
              className={buttonSecondaryClass}
            >
              {tc("actions.cancel")}
            </button>
          </div>
        </form>
      )}

      {openPanel === "apply_billable" && (
        <form
          action={billableForm.handleSubmit}
          className="mt-3 rounded-md border border-edge bg-surface-inset p-3 space-y-2"
        >
          <input type="hidden" name="project_id" value={projectId} />
          {billableForm.serverError && (
            <AlertBanner tone="error">{billableForm.serverError}</AlertBanner>
          )}
          <p className="text-body-lg text-content">
            {defaultBillable
              ? t("classification.confirmApplyBillableTrue")
              : t("classification.confirmApplyBillableFalse")}
          </p>
          <p className="text-caption text-content-muted">
            {t("classification.applyBillableSkipsInvoiced")}
          </p>
          <div className="flex gap-2">
            <SubmitButton
              label={t("classification.applyDefaultBillable")}
              pending={billableForm.pending}
              success={billableForm.success}
              successMessage={tc("actions.saved")}
              className={buttonDangerClass}
            />
            <button
              type="button"
              disabled={billableForm.pending}
              onClick={closePanel}
              className={buttonSecondaryClass}
            >
              {tc("actions.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
