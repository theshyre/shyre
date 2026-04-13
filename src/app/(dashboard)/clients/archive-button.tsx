"use client";

import { useTranslations } from "next-intl";
import { Archive } from "lucide-react";
import { buttonDangerClass } from "@/lib/form-styles";
import { archiveClientAction } from "./actions";

export function ArchiveButton({
  clientId,
}: {
  clientId: string;
}): React.JSX.Element {
  const tc = useTranslations("common");

  return (
    <form action={archiveClientAction}>
      <input type="hidden" name="id" value={clientId} />
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
