import { getTranslations } from "next-intl/server";
import { Target, TrendingUp, TrendingDown } from "lucide-react";
import { formatCurrency } from "@/lib/invoice-utils";
import { fixedBidStats } from "@/lib/projects/fixed-bid";

/**
 * "Did we hit the number?" — the fixed-bid profitability headline on the
 * project Overview. Quoted price, hours spent, and the EFFECTIVE realized $/hr
 * (price ÷ hours), plus over/under the budgeted-hours estimate as a 3-channel
 * (icon + text + color) cue. Rendered only for fixed-bid projects, and only
 * when the price is visible to the viewer (projects_v rate-gates fixed_price,
 * so a masked reader passes null → the Overview doesn't render this).
 */
export async function FixedBidCard({
  fixedPrice,
  spentMinutes,
  budgetHours,
  currency = "USD",
}: {
  fixedPrice: number;
  spentMinutes: number;
  budgetHours: number | null;
  currency?: string;
}): Promise<React.JSX.Element> {
  const t = await getTranslations("projects.fixedBid");
  const s = fixedBidStats(fixedPrice, spentMinutes, budgetHours);

  return (
    <section
      aria-label={t("heading")}
      className="rounded-lg border border-edge bg-surface-raised p-4"
    >
      <div className="mb-3 flex items-center gap-2">
        <Target size={16} className="text-accent" aria-hidden="true" />
        <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {t("heading")}
        </h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-caption text-content-muted">{t("quoted")}</p>
          <p className="text-title font-semibold text-content tabular-nums">
            {formatCurrency(fixedPrice, currency)}
          </p>
        </div>
        <div>
          <p className="text-caption text-content-muted">{t("spent")}</p>
          <p className="text-title font-semibold text-content tabular-nums">
            {t("hours", { hours: s.hours.toFixed(1) })}
          </p>
        </div>
        <div>
          <p className="text-caption text-content-muted">{t("effectiveRate")}</p>
          <p className="text-title font-semibold text-content tabular-nums">
            {s.effectiveRate != null
              ? t("perHour", { rate: formatCurrency(s.effectiveRate, currency) })
              : t("noHours")}
          </p>
        </div>
      </div>

      {s.overBudgetHours != null && budgetHours != null && (
        <div className="mt-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption font-medium ${
              s.overBudgetHours
                ? "border-warning/30 bg-warning-soft text-warning-text"
                : "border-success/30 bg-success-soft text-success-text"
            }`}
          >
            {s.overBudgetHours ? (
              <TrendingUp size={14} aria-hidden="true" />
            ) : (
              <TrendingDown size={14} aria-hidden="true" />
            )}
            {s.overBudgetHours
              ? t("overEstimate", {
                  pct: Math.abs(s.hoursVariancePct ?? 0).toFixed(0),
                  budget: budgetHours,
                })
              : t("underEstimate", {
                  pct: Math.abs(s.hoursVariancePct ?? 0).toFixed(0),
                  budget: budgetHours,
                })}
          </span>
        </div>
      )}
    </section>
  );
}
