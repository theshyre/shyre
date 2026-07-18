"use client";

import { useTranslations } from "next-intl";
import { PlugZap, Plug, ShieldAlert } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { setIntegrationsEnabledAction } from "./actions";

interface Props {
  teamId: string;
  enabled: boolean;
  /** Whether the viewer may flip the switch (team owner/admin). */
  isAdmin: boolean;
}

/**
 * The per-team integrations kill switch.
 *
 * Default-closed framing: the card leads with "off by default" copy and
 * shows the current state through icon + word + color (redundant
 * encoding). Owners/admins get the toggle inline; members get a hint to
 * ask their owner. Disabling is the SAFE direction (it blocks tokens
 * instantly), so it needs no confirmation tier — the warning copy under
 * the button is enough.
 */
export function KillSwitchCard({
  teamId,
  enabled,
  isAdmin,
}: Props): React.JSX.Element {
  const t = useTranslations("integrations.killSwitch");

  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: setIntegrationsEnabledAction,
  });

  const StateIcon = enabled ? PlugZap : Plug;

  return (
    <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StateIcon size={16} className="text-accent" aria-hidden="true" />
          <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
            {t("heading")}
          </h2>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium ${
            enabled
              ? "bg-success-soft text-success-text"
              : "bg-surface-inset text-content-muted"
          }`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-current"
            aria-hidden="true"
          />
          {enabled ? t("enabledBadge") : t("disabledBadge")}
        </span>
      </div>

      <p className="text-body text-content-secondary">
        {enabled ? t("enabledCopy") : t("defaultClosed")}
      </p>

      {serverError && <AlertBanner tone="error">{serverError}</AlertBanner>}

      {isAdmin ? (
        <form action={handleSubmit} className="space-y-2">
          <input type="hidden" name="team_id" value={teamId} />
          <input
            type="hidden"
            name="enabled"
            value={enabled ? "false" : "true"}
          />
          {/* Enable is the card's only next step in the disabled state
              → primary. Disable stays secondary (the warning caption
              carries its weight). */}
          <SubmitButton
            label={enabled ? t("disable") : t("enable")}
            pending={pending}
            pendingLabel={t("pending")}
            success={success}
            successMessage={t("saved")}
            icon={enabled ? Plug : PlugZap}
            className={enabled ? buttonSecondaryClass : buttonPrimaryClass}
          />
          {enabled && (
            <p className="flex items-center gap-1.5 text-caption text-warning-text">
              <ShieldAlert size={12} className="shrink-0" aria-hidden="true" />
              {t("disableWarning")}
            </p>
          )}
        </form>
      ) : (
        !enabled && (
          <p className="text-caption text-content-muted">{t("memberHint")}</p>
        )
      )}
    </section>
  );
}
