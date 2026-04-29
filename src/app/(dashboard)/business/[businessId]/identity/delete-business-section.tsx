"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Trash2 } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import {
  inputClass,
  buttonSecondaryClass,
  buttonDangerClass,
} from "@/lib/form-styles";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { deleteBusinessAction } from "../../actions";

interface Props {
  businessId: string;
  /** Stored legal name — null when the user hasn't filled in identity. */
  legalName: string | null;
  /** Seeded display name on the businesses row — non-null in practice. */
  name: string | null;
}

/**
 * Danger zone — delete the business. Owner-of-every-team only;
 * the action also enforces "must own another business" so the
 * actor doesn't strand themselves on a businessless account.
 *
 * Confirmation expected text follows the same fallback chain as
 * the layout header: legal_name → name → "this business" (final
 * defensive fallback; never reached in practice because `name`
 * is always seeded).
 */
export function DeleteBusinessSection({
  businessId,
  legalName,
  name,
}: Props): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const tc = useTranslations("common");
  const tb = useTranslations("business.danger");
  const { pending, serverError, handleSubmit } = useFormAction({
    action: deleteBusinessAction,
  });

  const expected = legalName ?? name ?? "";
  const canDelete = typed.trim() === expected && expected !== "" && !pending;

  return (
    <section className="rounded-lg border border-error/30 bg-surface-raised p-4 space-y-4 mt-6">
      <div className="flex items-center gap-2">
        <AlertTriangle size={18} className="text-error" />
        <h2 className="text-label font-semibold uppercase tracking-wider text-error">
          {tc("team.dangerZone")}
        </h2>
      </div>

      {!confirming ? (
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <p className="text-body font-medium text-content">
              {tb("title")}
            </p>
            <p className="text-caption text-content-muted mt-0.5">
              {tb("hint")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={buttonDangerClass}
          >
            <Trash2 size={16} />
            {tb("button")}
          </button>
        </div>
      ) : (
        <form
          action={handleSubmit}
          className="rounded-lg border border-error/30 bg-error-soft p-4 space-y-3"
        >
          <input type="hidden" name="business_id" value={businessId} />
          {serverError && <AlertBanner tone="error">{serverError}</AlertBanner>}
          <p className="text-body text-content">
            {tb("confirm", { name: expected })}
          </p>
          <input
            name="confirm_name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expected}
            className={inputClass}
            autoFocus
            disabled={pending}
          />
          <div className="flex gap-2">
            <SubmitButton
              label={tb("permanentDelete")}
              pending={pending}
              icon={Trash2}
              disabled={!canDelete}
              className="inline-flex items-center gap-2 rounded-lg bg-error px-4 py-2 text-body font-medium text-content-inverse hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            />
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setTyped("");
              }}
              disabled={pending}
              className={buttonSecondaryClass}
            >
              {tc("actions.cancel")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
