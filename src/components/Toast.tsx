"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  ToastProvider as BaseToastProvider,
  useToast,
  type Toast,
  type ToastKind,
} from "@theshyre/ui";

export { useToast };
export type { Toast, ToastKind };

/**
 * Shyre-local `ToastProvider` — wires `common.toast.dismiss` into the
 * underlying `@theshyre/ui` provider's `dismissLabel`. Everything else
 * is delegated to the shared implementation.
 */
export function ToastProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const t = useTranslations("common.toast");
  return (
    <BaseToastProvider dismissLabel={t("dismiss")}>{children}</BaseToastProvider>
  );
}
