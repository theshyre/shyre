"use client";

import { useEffect, useRef } from "react";
import { useTableDensity, type TableDensity } from "./table-density-provider";

interface Props {
  /** Density read from `user_settings.table_density` on the server.
   *  `null` means the user hasn't chosen one — the localStorage path
   *  + the "regular" default in the provider take over. */
  preferredDensity: TableDensity | null;
}

/**
 * One-way DB → provider sync. Runs once per mount and only if the
 * server-read preference differs from what the provider is showing.
 * Same ref-guard pattern as TextSizeSync — without it, an in-app
 * toggle click would round-trip through this effect and undo itself.
 */
export function TableDensitySync({ preferredDensity }: Props): null {
  const { density, applyExternalDensity } = useTableDensity();
  const didSync = useRef(false);

  useEffect(() => {
    if (didSync.current) return;
    didSync.current = true;
    if (preferredDensity && preferredDensity !== density) {
      applyExternalDensity(preferredDensity);
    }
  }, [preferredDensity, density, applyExternalDensity]);

  return null;
}
