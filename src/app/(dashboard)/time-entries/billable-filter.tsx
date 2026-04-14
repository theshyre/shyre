"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { DollarSign } from "lucide-react";

interface Props {
  active: boolean;
}

export function BillableFilter({ active }: Props): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("time.billableFilter");

  const toggle = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (active) {
      params.delete("billable");
    } else {
      params.set("billable", "1");
    }
    router.push(`${pathname}?${params.toString()}`);
  }, [active, router, pathname, searchParams]);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-success-soft text-success"
          : "bg-surface-inset text-content-secondary hover:bg-hover"
      }`}
    >
      <DollarSign size={12} />
      {active ? t("on") : t("off")}
    </button>
  );
}
