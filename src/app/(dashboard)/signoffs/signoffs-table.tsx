"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  tableClass,
  tableWrapperClass,
  tableHeaderRowClass,
  tableHeaderCellClass,
  tableBodyRowClass,
  tableBodyCellClass,
} from "@/lib/table-styles";
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

export function SignoffsTable({ rows }: { rows: SignoffRow[] }): React.JSX.Element {
  const t = useTranslations("signoff");

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-edge bg-surface-raised px-4 py-10 text-center">
        <p className="text-body text-content-secondary">{t("empty")}</p>
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
