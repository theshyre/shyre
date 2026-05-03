"use client";

import { useTranslations } from "next-intl";
import { AlertBanner } from "@theshyre/ui";
import { Cloud } from "lucide-react";
import { inputClass, labelClass } from "@/lib/form-styles";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { updateDeployConfigAction } from "./actions";

interface Props {
  initial: {
    apiTokenSet: boolean;
    projectId: string;
    vercelTeamId: string;
    deployHookUrl: string;
  };
}

export function DeployConnectionForm({ initial }: Props): React.JSX.Element {
  const t = useTranslations("messaging.deploy");
  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: updateDeployConfigAction,
  });

  return (
    <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Cloud size={16} className="text-accent" />
        <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {t("connection.heading")}
        </h2>
      </div>
      <p className="text-caption text-content-muted">
        {t("connection.intro")}
      </p>

      <form action={handleSubmit} className="space-y-3">
        {serverError && <AlertBanner tone="error">{serverError}</AlertBanner>}

        <div>
          <label className={labelClass} htmlFor="api_token">
            {t("connection.apiToken")}
          </label>
          <input
            id="api_token"
            name="api_token"
            type="password"
            autoComplete="off"
            required={!initial.apiTokenSet}
            placeholder={
              initial.apiTokenSet
                ? t("connection.apiTokenSetPlaceholder")
                : t("connection.apiTokenPlaceholder")
            }
            className={`${inputClass} font-mono`}
          />
          <p className="mt-1 text-caption text-content-muted">
            {t("connection.apiTokenHint")}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="project_id">
              {t("connection.projectId")}
            </label>
            <input
              id="project_id"
              name="project_id"
              required
              defaultValue={initial.projectId}
              placeholder="prj_..."
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1 text-caption text-content-muted">
              {t("connection.projectIdHint")}
            </p>
          </div>
          <div>
            <label className={labelClass} htmlFor="vercel_team_id">
              {t("connection.vercelTeamId")}
            </label>
            <input
              id="vercel_team_id"
              name="vercel_team_id"
              defaultValue={initial.vercelTeamId}
              placeholder="team_..."
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1 text-caption text-content-muted">
              {t("connection.vercelTeamIdHint")}
            </p>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="deploy_hook_url">
            {t("connection.deployHookUrl")}
          </label>
          <input
            id="deploy_hook_url"
            name="deploy_hook_url"
            type="url"
            defaultValue={initial.deployHookUrl}
            placeholder="https://api.vercel.com/v1/integrations/deploy/..."
            className={`${inputClass} font-mono`}
          />
          <p className="mt-1 text-caption text-content-muted">
            {t("connection.deployHookUrlHint")}
          </p>
        </div>

        <SubmitButton
          label={t("connection.save")}
          pending={pending}
          success={success}
          icon={Cloud}
        />
      </form>
    </section>
  );
}
