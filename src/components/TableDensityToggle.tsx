"use client";

import { useTransition } from "react";
import { Rows4, Rows3, Rows2 } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import {
  useTableDensity,
  type TableDensity,
} from "./table-density-provider";
import { updateTableDensityAction } from "./table-density-action";

interface Props {
  /** Optional class — typically used to position relative to a table
   *  header so the toggle sits alongside the title or a filter row. */
  className?: string;
}

/**
 * Three-button density toggle. Mirrors the visual rhythm of the
 * sidebar's text-size toggle: small icon-only buttons in a single
 * row, accent fill on the active level. Click → updates the
 * provider (instant local effect via data-density on `<html>` and
 * the localStorage anti-flash cache) AND fires off the server
 * action so the choice is persisted across devices. The server
 * action is fire-and-forget — local state already changed
 * optimistically, so a transient network failure never strands
 * the user with a half-applied UI.
 */
export function TableDensityToggle({ className = "" }: Props): React.JSX.Element {
  const { density, setDensity } = useTableDensity();
  const [, startTransition] = useTransition();

  const change = (next: TableDensity): void => {
    if (next === density) return;
    setDensity(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("table_density", next);
      try {
        await updateTableDensityAction(fd);
      } catch {
        // Local state already changed; logged server-side via
        // runSafeAction. Don't bother the user with a toast.
      }
    });
  };

  return (
    <div
      role="group"
      aria-label="Table density"
      className={`inline-flex items-center rounded-md border border-edge bg-surface-raised p-0.5 ${className}`}
    >
      <DensityButton
        active={density === "compact"}
        onClick={() => change("compact")}
        label="Compact"
        Icon={Rows4}
      />
      <DensityButton
        active={density === "regular"}
        onClick={() => change("regular")}
        label="Regular"
        Icon={Rows3}
      />
      <DensityButton
        active={density === "comfortable"}
        onClick={() => change("comfortable")}
        label="Comfortable"
        Icon={Rows2}
      />
    </div>
  );
}

function DensityButton({
  active,
  onClick,
  label,
  Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  Icon: typeof Rows3;
}): React.JSX.Element {
  return (
    <Tooltip label={label} labelMode="label">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`inline-flex items-center justify-center rounded-sm px-1.5 py-1 transition-colors ${
          active
            ? "bg-accent text-accent-text"
            : "text-content-muted hover:bg-hover hover:text-content"
        }`}
      >
        <Icon size={14} />
      </button>
    </Tooltip>
  );
}
