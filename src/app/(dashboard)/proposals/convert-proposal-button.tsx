"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { FolderPlus } from "lucide-react";
import { buttonPrimaryClass, selectClass } from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { convertProposalAction } from "./actions";

interface Props {
  proposalId: string;
  /** Top-level projects of the same customer the created projects can nest
   *  under (an account umbrella). Empty → the picker is hidden and everything
   *  converts at the top level. */
  eligibleParents: Array<{ id: string; name: string }>;
}

/** Convert the accepted line items into projects — one project per top-level
 *  line item (phases stay on the proposal as the item's breakdown). Optionally
 *  nests all of them under a chosen parent project. */
export function ConvertProposalButton({
  proposalId,
  eligibleParents,
}: Props): React.JSX.Element {
  const t = useTranslations("proposals.detail");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string>("");

  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      {eligibleParents.length > 0 && (
        <label className="inline-flex items-center gap-2 text-caption text-content-secondary">
          {t("convertNestUnder")}
          <select
            className={selectClass}
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            disabled={pending}
          >
            <option value="">{t("convertNestNone")}</option>
            {eligibleParents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className={buttonPrimaryClass}
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const fd = new FormData();
              fd.set("id", proposalId);
              if (parentId) fd.set("parent_project_id", parentId);
              await assertActionResult(convertProposalAction(fd));
            } catch (err) {
              setError(err instanceof Error ? err.message : t("convertFailed"));
            }
          });
        }}
      >
        <FolderPlus size={16} aria-hidden="true" />
        {pending ? t("converting") : t("convert")}
      </button>
      {error && (
        <span role="alert" className="text-caption text-error">
          {error}
        </span>
      )}
    </span>
  );
}
