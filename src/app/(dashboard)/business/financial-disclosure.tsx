"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface Props {
  showLabel: string;
  hideLabel: string;
  /** The server-rendered financial panel. Kept OUT of the DOM while
   *  collapsed — this is a privacy control, not a visual fold. */
  children: React.ReactNode;
}

/**
 * Collapsed-by-default wrapper for the business card's money tiles.
 *
 * Marcus (2026-07-20): opening /business while screen-sharing pops
 * revenue/expenses/net at whoever is watching. Financials now require
 * an explicit click, every visit — deliberately NOT persisted, so the
 * page is always safe to open in front of someone.
 */
export function FinancialDisclosure({
  showLabel,
  hideLabel,
  children,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-caption font-medium text-content-secondary hover:bg-hover transition-colors"
      >
        {open ? (
          <EyeOff size={12} aria-hidden="true" />
        ) : (
          <Eye size={12} aria-hidden="true" />
        )}
        {open ? hideLabel : showLabel}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
