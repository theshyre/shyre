"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  InlineDeleteRowConfirm as BaseInlineDeleteRowConfirm,
  type InlineDeleteRowConfirmLabels,
} from "@theshyre/ui";
import type { ComponentProps } from "react";

type BaseProps = ComponentProps<typeof BaseInlineDeleteRowConfirm>;

/**
 * Shyre-local `InlineDeleteRowConfirm` — wires `time.rowDelete.*` (prompt
 * strings) and `common.actions.*` (button labels) into the underlying
 * `@theshyre/ui` component's `labels` prop.
 */
export function InlineDeleteRowConfirm(
  props: Omit<BaseProps, "labels">,
): React.JSX.Element {
  const tActions = useTranslations("common.actions");
  const tRow = useTranslations("time.rowDelete");
  const labels = useMemo<InlineDeleteRowConfirmLabels>(
    () => ({
      prompt: (word) => tRow("prompt", { word }),
      promptWithSummary: (word, summary) =>
        tRow("promptWithSummary", { word, summary }),
      inputLabel: tRow("inputLabel"),
      confirmDelete: tActions("confirmDelete"),
      delete: tActions("delete"),
      cancel: tActions("cancel"),
    }),
    [tActions, tRow],
  );
  return <BaseInlineDeleteRowConfirm {...props} labels={labels} />;
}
