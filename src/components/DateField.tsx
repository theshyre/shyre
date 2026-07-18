"use client";

/**
 * i18n wrapper around `@theshyre/ui`'s `DateField` (promoted 2026-07-18).
 *
 * The package component is next-intl-free: it takes a `DateFieldLabels`
 * object (English defaults) and a `displayLocale` for Intl month/weekday
 * names. This wrapper injects both from the app's next-intl context so
 * the 20+ existing call sites keep importing from `@/components/DateField`
 * with zero changes — the sanctioned "re-export wrapper only when it adds
 * i18n" pattern from docs/reference/shared-packages.md.
 *
 * The date logic, popover, keyboard grid, and their tests live in
 * theshyre-core. Helpers re-export unchanged.
 */

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  DateField as UIDateField,
  type DateFieldLabels,
  type DateFieldProps as UIDateFieldProps,
} from "@theshyre/ui";

export {
  localeToFormat,
  parseIsoDate,
  formatForDisplay,
  looseParse,
  type DateFieldPreset,
  type DateFieldDisplayFormat,
} from "@theshyre/ui";

export type DateFieldProps = Omit<UIDateFieldProps, "labels" | "displayLocale">;

export function DateField(props: DateFieldProps): React.JSX.Element {
  const tDate = useTranslations("common.dateField");
  const locale = useLocale();
  const labels = useMemo<DateFieldLabels>(
    () => ({
      openCalendar: tDate("openCalendar"),
      calendar: tDate("calendar"),
      prevMonth: (month) => tDate("prevMonth", { month }),
      nextMonth: (month) => tDate("nextMonth", { month }),
      clear: tDate("clear"),
      today: tDate("today"),
      toOpenHint: tDate("toOpenHint"),
      todayCell: (iso) => tDate("todayCell", { iso }),
    }),
    [tDate],
  );
  return <UIDateField {...props} displayLocale={locale} labels={labels} />;
}
