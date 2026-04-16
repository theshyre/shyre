"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  InlineDeleteButton as BaseInlineDeleteButton,
  type InlineDeleteButtonLabels,
} from "@theshyre/ui";
import type { ComponentProps } from "react";

type BaseProps = ComponentProps<typeof BaseInlineDeleteButton>;

/**
 * Shyre-local `InlineDeleteButton` — wires `common.actions.*` into the
 * underlying `@theshyre/ui` component's `labels` prop.
 */
export function InlineDeleteButton(
  props: Omit<BaseProps, "labels">,
): React.JSX.Element {
  const t = useTranslations("common.actions");
  const labels = useMemo<InlineDeleteButtonLabels>(
    () => ({
      confirmDelete: t("confirmDelete"),
      delete: t("delete"),
      cancel: t("cancel"),
    }),
    [t],
  );
  return <BaseInlineDeleteButton {...props} labels={labels} />;
}
