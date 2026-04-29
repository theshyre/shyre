"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * Table-density provider. Three levels of compactness applied via
 * `data-density` on the `<html>` element + CSS variables (see
 * `globals.css`). localStorage is the session anti-flash cache;
 * `user_settings.table_density` is the cross-device source of truth,
 * synced by `<TableDensitySync />` on dashboard mount.
 *
 * Inline (not in `@theshyre/theme`) for now — Shyre's CSV-import
 * recategorize flow drove the need; Liv hasn't asked for it. Promote
 * to the shared package when a second consumer appears.
 */

export type TableDensity = "compact" | "regular" | "comfortable";

const DENSITIES: readonly TableDensity[] = [
  "compact",
  "regular",
  "comfortable",
];

const STORAGE_KEY = "stint-table-density";
const CHANGE_EVENT = "stint-table-density-change";

export interface TableDensityContextValue {
  density: TableDensity;
  setDensity: (next: TableDensity) => void;
  applyExternalDensity: (next: TableDensity) => void;
  densities: readonly TableDensity[];
}

const TableDensityContext = createContext<TableDensityContextValue | null>(
  null,
);

function applyDensity(d: TableDensity): void {
  document.documentElement.setAttribute("data-density", d);
}

function readStoredDensity(): TableDensity {
  if (typeof window === "undefined") return "regular";
  const stored = localStorage.getItem(STORAGE_KEY) as TableDensity | null;
  return stored && DENSITIES.includes(stored) ? stored : "regular";
}

function subscribeToDensity(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeDensity(next: TableDensity): void {
  localStorage.setItem(STORAGE_KEY, next);
  applyDensity(next);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function TableDensityProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const density = useSyncExternalStore<TableDensity>(
    subscribeToDensity,
    readStoredDensity,
    () => "regular",
  );

  // Apply the current density to the <html> attr on mount + whenever
  // it changes. useSyncExternalStore reads the localStorage value
  // but doesn't fire side effects — without this, a returning user
  // with `compact` in localStorage would see "regular" CSS until
  // they manually toggled.
  useEffect(() => {
    applyDensity(density);
  }, [density]);

  const setDensity = useCallback(
    (next: TableDensity) => writeDensity(next),
    [],
  );
  const applyExternalDensity = useCallback(
    (next: TableDensity) => writeDensity(next),
    [],
  );

  return (
    <TableDensityContext.Provider
      value={{
        density,
        setDensity,
        applyExternalDensity,
        densities: DENSITIES,
      }}
    >
      {children}
    </TableDensityContext.Provider>
  );
}

export function useTableDensity(): TableDensityContextValue {
  const ctx = useContext(TableDensityContext);
  if (!ctx) {
    throw new Error(
      "useTableDensity must be used within TableDensityProvider",
    );
  }
  return ctx;
}
