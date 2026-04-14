"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { buttonSecondaryClass } from "@/lib/form-styles";

export function ExportButton(): React.JSX.Element {
  const t = useTranslations("time.export");
  const params = useSearchParams();
  const href = `/api/time-entries/export?${params.toString()}`;

  return (
    <a href={href} download className={buttonSecondaryClass} title={t("hint")}>
      <Download size={14} />
      {t("label")}
    </a>
  );
}
