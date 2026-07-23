"use client";

import Link from "next/link";
import { FileCheck2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  tableClass,
  tableWrapperClass,
  tableHeaderRowClass,
  tableHeaderCellClass,
  tableBodyRowClass,
  tableBodyCellClass,
} from "@/lib/table-styles";
import { buttonPrimaryClass } from "@/lib/form-styles";
import { SignoffStatusBadge } from "./signoff-status-badge";

export interface SignoffRow {
  id: string;
  title: string;
  versionLabel: string | null;
  status: string;
  customerName: string | null;
  signerCount: number;
  createdAt: string;
}

export function SignoffsTable({
  rows,
  canCreate = false,
}: {
  rows: SignoffRow[];
  canCreate?: boolean;
}): React.JSX.Element {
  const t = useTranslations("signoff");

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-edge bg-surface-raised px-4 py-12 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
          <FileCheck2 size={20} className="text-accent" aria-hidden="true" />
        </div>
        <p className="text-body-lg font-medium text-content">{t("emptyHeading")}</p>
        <p className="mx-auto mt-1 max-w-[420px] text-body text-content-secondary">{t("empty")}</p>
        {canCreate && (
          <Link href="/signoffs/new" className={`${buttonPrimaryClass} mt-4 inline-flex`}>
            <Plus size={16} />
            {t("newSignoff")}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className={tableWrapperClass}>
      <table className={tableClass}>
        <thead>
          <tr className={tableHeaderRowClass}>
            <th className={tableHeaderCellClass}>{t("col.title")}</th>
            <th className={tableHeaderCellClass}>{t("col.customer")}</th>
            <th className={tableHeaderCellClass}>{t("col.signers")}</th>
            <th className={tableHeaderCellClass}>{t("col.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={tableBodyRowClass}>
              <td className={tableBodyCellClass}>
                <Link
                  href={`/signoffs/${r.id}`}
                  className="font-medium text-content hover:text-accent"
                >
                  {r.title || t("untitled")}
                </Link>
                {r.versionLabel && (
                  <span className="ml-2 text-label text-content-muted">{r.versionLabel}</span>
                )}
              </td>
              <td className={tableBodyCellClass}>
                {r.customerName ?? <span className="text-content-muted">—</span>}
              </td>
              <td className={tableBodyCellClass}>{r.signerCount}</td>
              <td className={tableBodyCellClass}>
                <SignoffStatusBadge status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
