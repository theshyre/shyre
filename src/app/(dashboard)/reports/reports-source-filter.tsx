"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Bot, Layers, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonGhostClass } from "@/lib/form-styles";
import type { ReportsSource } from "./reports-source";

const SOURCES: ReadonlyArray<{
  key: ReportsSource;
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}> = [
  { key: "all", icon: Layers },
  { key: "human", icon: User },
  { key: "agent", icon: Bot },
];

/**
 * "Source" lens for the reports page — All / Human / Agent. Follows
 * the ReportsPeriodFilter pattern: URL-param driven so the server
 * page re-aggregates, active state via aria-selected + accent color
 * on top of the always-visible icon + label (≥2 channels).
 */
export function ReportsSourceFilter({
  source,
}: {
  source: ReportsSource;
}): React.JSX.Element {
  const t = useTranslations("reports");
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const setSource = useCallback(
    (next: ReportsSource): void => {
      const sp = new URLSearchParams(params.toString());
      if (next === "all") {
        sp.delete("source");
      } else {
        sp.set("source", next);
      }
      startTransition(() => {
        router.push(`?${sp.toString()}`);
      });
    },
    [params, router],
  );

  // Not tabs: these buttons rewrite a URL param over server-rendered
  // content — there is no tabpanel and no arrow-key roving focus, so
  // announcing "tab" would promise semantics the page doesn't have.
  // A group of toggle buttons (aria-pressed) matches the behavior.
  // Buttons stay enabled during the transition: repeat pushes are
  // harmless, and disabling would drop keyboard focus to <body>;
  // pending feedback comes from the global <TopProgressBar />.
  // Active state carries ≥2 channels: accent background + a real
  // border (borders survive forced-colors where tints flatten), on
  // top of aria-pressed. isPending only softens the strip visually.
  return (
    <div
      className={`flex flex-wrap gap-2 ${isPending ? "opacity-70" : ""}`}
      role="group"
      aria-label={t("source.label")}
    >
      {SOURCES.map(({ key, icon: Icon }) => {
        const active = source === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => setSource(key)}
            className={`${buttonGhostClass} border ${active ? "bg-accent-soft text-accent-text border-accent" : "border-transparent"}`}
          >
            <Icon size={14} aria-hidden />
            {t(`source.${key}`)}
          </button>
        );
      })}
    </div>
  );
}
