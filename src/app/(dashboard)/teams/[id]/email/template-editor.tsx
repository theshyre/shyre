"use client";

import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import {
  inputClass,
  textareaClass,
  labelClass,
} from "@/lib/form-styles";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { TEMPLATE_VARIABLES } from "@/lib/messaging/variables";
import { updateMessageTemplateAction } from "./actions";

type Kind = "invoice_send" | "invoice_reminder" | "payment_thanks";

export function TemplateEditor({
  teamId,
  kind,
  initial,
}: {
  teamId: string;
  kind: Kind;
  initial: { subject: string; body: string };
}): React.JSX.Element {
  const t = useTranslations("messaging");
  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: updateMessageTemplateAction,
  });

  // Filter variables to those meaningful for this kind. Keeps the
  // sidebar from showing `%days_past_due%` on the invoice-send
  // editor where it'd always render to nothing.
  const variables = TEMPLATE_VARIABLES.filter((v) => v.kinds.includes(kind));

  return (
    <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-4">
      <div className="flex items-center gap-2">
        <FileText size={16} className="text-accent" />
        <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {t(`template.heading.${kind}`)}
        </h2>
      </div>
      <p className="text-caption text-content-muted">
        {t(`template.intro.${kind}`)}
      </p>

      <form action={handleSubmit} className="grid gap-4 sm:grid-cols-[1fr_240px]">
        <input type="hidden" name="team_id" value={teamId} />
        <input type="hidden" name="kind" value={kind} />

        <div className="space-y-3">
          {serverError && <AlertBanner tone="error">{serverError}</AlertBanner>}

          <div>
            <label className={labelClass} htmlFor={`subject-${kind}`}>
              {t("template.subjectLabel")}
            </label>
            <input
              id={`subject-${kind}`}
              name="subject"
              required
              defaultValue={initial.subject}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`body-${kind}`}>
              {t("template.bodyLabel")}
            </label>
            <textarea
              id={`body-${kind}`}
              name="body"
              required
              rows={12}
              defaultValue={initial.body}
              className={`${textareaClass} font-mono text-caption`}
            />
          </div>
          <SubmitButton
            label={t("template.save")}
            pending={pending}
            success={success}
            icon={FileText}
          />
        </div>

        <aside className="rounded-md border border-edge bg-surface p-3 space-y-2 self-start">
          <p className="text-label font-semibold uppercase tracking-wider text-content-muted">
            {t("template.variablesHeading")}
          </p>
          <p className="text-caption text-content-muted">
            {t("template.variablesIntro")}
          </p>
          <ul className="space-y-2 text-caption">
            {variables.map((v) => (
              <li key={v.key}>
                <code className="text-accent">%{v.key}%</code>
                <span className="block text-content-muted">{v.description}</span>
              </li>
            ))}
          </ul>
        </aside>
      </form>
    </section>
  );
}
