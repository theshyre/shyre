"use client";

import { Archive } from "lucide-react";
import { buttonDangerClass } from "@/lib/form-styles";
import { archiveClientAction } from "./actions";

export function ArchiveButton({
  clientId,
}: {
  clientId: string;
}): React.JSX.Element {
  return (
    <form action={archiveClientAction}>
      <input type="hidden" name="id" value={clientId} />
      <button
        type="submit"
        className={buttonDangerClass}
        onClick={(e) => {
          if (!confirm("Archive this client?")) {
            e.preventDefault();
          }
        }}
      >
        <Archive size={14} />
        Archive
      </button>
    </form>
  );
}
