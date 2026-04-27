import { NextIntlClientProvider } from "next-intl";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import en from "@/lib/i18n/locales/en/common.json";
import time from "@/lib/i18n/locales/en/time.json";
import categories from "@/lib/i18n/locales/en/categories.json";
import templates from "@/lib/i18n/locales/en/templates.json";
import settings from "@/lib/i18n/locales/en/settings.json";
import profile from "@/lib/i18n/locales/en/profile.json";
import business from "@/lib/i18n/locales/en/business.json";
import errors from "@/lib/i18n/locales/en/errors.json";
import admin from "@/lib/i18n/locales/en/admin.json";
import invoices from "@/lib/i18n/locales/en/invoices.json";

export const testMessages = {
  common: en,
  time,
  categories,
  templates,
  settings,
  profile,
  business,
  errors,
  admin,
  invoices,
} as const;

/**
 * Render a component with NextIntlClientProvider wired to English messages.
 */
export function renderWithIntl(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <NextIntlClientProvider locale="en" messages={testMessages}>
        {children}
      </NextIntlClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
