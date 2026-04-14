"use client";

import { useTranslations } from "next-intl";
import { Archive } from "lucide-react";
import { buttonDangerClass } from "@/lib/form-styles";
import { archiveCustomerAction } from "./actions";

export function ArchiveButton({
  customerId,
}: {
  customerId: string;
}): React.JSX.Element {
  const tc = useTranslations("common");

  return (
    <form action={archiveCustomerAction}>
      <input type="hidden" name="id" value={customerId} />
      <button
        type="submit"
        className={buttonDangerClass}
        onClick={(e) => {
          if (!confirm(tc("confirm.archive", { item: "client" }))) {
            e.preventDefault();
          }
        }}
      >
        <Archive size={14} />
        {tc("actions.archive")}
      </button>
    </form>
  );
}
