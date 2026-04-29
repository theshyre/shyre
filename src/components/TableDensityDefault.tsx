"use client";

import { useEffect } from "react";
import {
  useTableDensity,
  type TableDensity,
} from "./table-density-provider";

const STORAGE_KEY = "stint-table-density";

interface Props {
  /** The density this page wants when no user-level preference exists.
   *  E.g. expenses defaults to "compact" because post-import recategorize
   *  is dense scanning work. */
  preferred: TableDensity;
}

/**
 * Per-page density nudge. Renders nothing; on mount, if the user
 * has no stored density preference (localStorage empty — meaning
 * the user has never clicked the toggle, ever), applies the page's
 * preferred density. Once the user picks anything via the toggle,
 * that choice writes to localStorage and this component becomes a
 * no-op for subsequent visits.
 *
 * Why localStorage and not also user_settings: the DB sync runs at
 * the dashboard layout level via `<TableDensitySync />` and only
 * applies when DB has a value. If localStorage is empty AND DB is
 * empty, nothing has been applied yet — that's the case this hook
 * targets. Anything else has already been respected by the time
 * this component mounts.
 */
export function TableDensityDefault({ preferred }: Props): null {
  const { density, applyExternalDensity } = useTableDensity();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(STORAGE_KEY)) return; // user has picked
    if (density === preferred) return; // already there
    applyExternalDensity(preferred);
  }, [preferred, density, applyExternalDensity]);

  return null;
}
