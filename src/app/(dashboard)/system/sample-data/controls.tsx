"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sparkles, Trash2, AlertTriangle } from "lucide-react";
import { Spinner } from "@theshyre/ui";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonDangerClass,
  inputClass,
  labelClass,
} from "@/lib/form-styles";
import { useFormAction } from "@/hooks/use-form-action";
import {
  loadSampleDataAction,
  removeSampleDataAction,
  clearAllTeamDataAction,
  cleanupOrphanTeamsAction,
} from "./actions";

interface Props {
  teamId: string;
  teamName: string;
  hasSample: boolean;
}

export function SampleDataControls({ teamId, teamName, hasSample }: Props): React.JSX.Element {
  const t = useTranslations("sampleData");
  const router = useRouter();

  const load = useFormAction({
    action: loadSampleDataAction,
    onSuccess: () => router.refresh(),
  });
  const remove = useFormAction({
    action: removeSampleDataAction,
    onSuccess: () => router.refresh(),
  });
  const clearAll = useFormAction({
    action: clearAllTeamDataAction,
    onSuccess: () => {
      setConfirmOpen(false);
      setConfirmName("");
      router.refresh();
    },
  });
  const cleanup = useFormAction({
    action: cleanupOrphanTeamsAction,
    onSuccess: () => router.refresh(),
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Load / replay */}
      <section className="rounded-lg border border-edge bg-surface-raised p-5 space-y-3">
        <h2 className="text-body-lg font-semibold text-content flex items-center gap-2">
          <Sparkles size={16} className="text-accent" />
          {hasSample ? t("replay.title") : t("load.title")}
        </h2>
        <p className="text-body-lg text-content-secondary">
          {hasSample ? t("replay.description") : t("load.description")}
        </p>
        <form action={load.handleSubmit}>
          <input type="hidden" name="team_id" value={teamId} />
          <button
            type="submit"
            disabled={load.pending}
            className={buttonPrimaryClass}
          >
            {load.pending ? (
              <Spinner />
            ) : (
              <Sparkles size={16} />
            )}
            {load.pending
              ? t("load.pending")
              : hasSample
                ? t("replay.button")
                : t("load.button")}
          </button>
          {load.serverError && (
            <p className="mt-2 text-body-lg text-error">{load.serverError}</p>
          )}
        </form>
      </section>

      {/* Remove sample */}
      <section className="rounded-lg border border-edge bg-surface-raised p-5 space-y-3">
        <h2 className="text-body-lg font-semibold text-content flex items-center gap-2">
          <Trash2 size={16} className="text-content-muted" />
          {t("remove.title")}
        </h2>
        <p className="text-body-lg text-content-secondary">{t("remove.description")}</p>
        <form action={remove.handleSubmit}>
          <input type="hidden" name="team_id" value={teamId} />
          <button
            type="submit"
            disabled={remove.pending || !hasSample}
            className={buttonSecondaryClass}
          >
            {remove.pending ? (
              <Spinner />
            ) : (
              <Trash2 size={16} />
            )}
            {remove.pending ? t("remove.pending") : t("remove.button")}
          </button>
          {!hasSample && (
            <p className="mt-2 text-caption text-content-muted">{t("remove.nothing")}</p>
          )}
          {remove.serverError && (
            <p className="mt-2 text-body-lg text-error">{remove.serverError}</p>
          )}
        </form>
      </section>

      {/* Cleanup orphan personal teams */}
      <section className="md:col-span-2 rounded-lg border border-edge bg-surface-raised p-5 space-y-3">
        <h2 className="text-body-lg font-semibold text-content flex items-center gap-2">
          <Trash2 size={16} className="text-content-muted" />
          {t("orphans.title")}
        </h2>
        <p className="text-body-lg text-content-secondary max-w-3xl">
          {t("orphans.description")}
        </p>
        <form action={cleanup.handleSubmit}>
          <button
            type="submit"
            disabled={cleanup.pending}
            className={buttonSecondaryClass}
          >
            {cleanup.pending ? <Spinner /> : <Trash2 size={16} />}
            {cleanup.pending ? t("orphans.pending") : t("orphans.button")}
          </button>
          {cleanup.serverError && (
            <p className="mt-2 text-body-lg text-error">{cleanup.serverError}</p>
          )}
        </form>
      </section>

      {/* Danger: clear all org data */}
      <section className="md:col-span-2 rounded-lg border border-error/40 bg-error-soft/30 p-5 space-y-3">
        <h2 className="text-body-lg font-semibold text-error flex items-center gap-2">
          <AlertTriangle size={16} />
          {t("clear.title")}
        </h2>
        <p className="text-body-lg text-content-secondary">{t("clear.description")}</p>

        {!confirmOpen ? (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className={buttonDangerClass}
          >
            <AlertTriangle size={16} />
            {t("clear.open")}
          </button>
        ) : (
          <form action={clearAll.handleSubmit} className="space-y-3">
            <input type="hidden" name="team_id" value={teamId} />
            <div>
              <label className={labelClass} htmlFor="confirm_name">
                {t("clear.confirmLabel", { name: teamName })}
              </label>
              <input
                id="confirm_name"
                name="confirm_name"
                type="text"
                autoComplete="off"
                autoFocus
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                className={inputClass}
                placeholder={teamName}
                disabled={clearAll.pending}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={clearAll.pending || confirmName !== teamName}
                className={buttonDangerClass}
              >
                {clearAll.pending ? (
                  <Spinner />
                ) : (
                  <AlertTriangle size={16} />
                )}
                {clearAll.pending ? t("clear.pending") : t("clear.confirm")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmName("");
                  clearAll.reset();
                }}
                disabled={clearAll.pending}
                className={buttonSecondaryClass}
              >
                {t("clear.cancel")}
              </button>
            </div>
            {clearAll.serverError && (
              <p className="text-body-lg text-error">{clearAll.serverError}</p>
            )}
          </form>
        )}
      </section>
    </div>
  );
}
