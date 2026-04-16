"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  SaveStatus as BaseSaveStatus,
  type SaveStatusLabels,
} from "@theshyre/ui";
import type { SaveStatus as SaveStatusValue } from "@/hooks/useAutosaveStatus";

interface Props {
  status: SaveStatusValue;
  lastSavedAt: number | null;
  lastError?: string | null;
  onRetry?: () => void;
  idleVisible?: boolean;
  className?: string;
}

/**
 * Shyre-local `SaveStatus` — wires `common.saveStatus.*` into the
 * underlying `@theshyre/ui` component's `labels` prop.
 */
export function SaveStatus(props: Props): React.JSX.Element | null {
  const t = useTranslations("common.saveStatus");
  const labels = useMemo<SaveStatusLabels>(
    () => ({
      saving: t("saving"),
      error: t("error"),
      errorRetry: t("errorRetry"),
      idle: t("idle"),
      savedJustNow: t("savedJustNow"),
      savedSecondsAgo: (seconds) => t("savedSecondsAgo", { seconds }),
      savedMinutesAgo: (minutes) => t("savedMinutesAgo", { minutes }),
      savedHoursAgo: (hours) => t("savedHoursAgo", { hours }),
    }),
    [t],
  );
  return <BaseSaveStatus {...props} labels={labels} />;
}
