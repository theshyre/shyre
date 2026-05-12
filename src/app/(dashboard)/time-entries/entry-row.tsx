"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { DollarSign, Minus, Lock } from "lucide-react";
import { formatDurationHM } from "@/lib/time/week";
import { EntryAuthor } from "@/components/EntryAuthor";
import { Tooltip } from "@/components/Tooltip";
import { TicketChip } from "@/components/TicketChip";
import { CustomerChip } from "@/components/CustomerChip";
import { EntryKebabMenu } from "./entry-kebab-menu";
import { InlineEditForm } from "./inline-edit-form";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface Props {
  entry: TimeEntry;
  projects: ProjectOption[];
  categories: CategoryOption[];
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  /** Total number of columns in the parent table — used for the edit row span */
  columnCount: number;
  tzOffsetMin?: number;
  /** True when this entry is in the multi-row selection set. */
  selected: boolean;
  onToggleSelect: (id: string) => void;
  /** True when the viewer authored this entry — gates the chip's
   *  refresh button. The action checks the same on the server. */
  canRefresh?: boolean;
  /** Customer-color left rail. Painted on the leading checkbox cell
   *  so contiguous same-customer rows form a connected vertical
   *  band that ties them to their CustomerSubHeader above. Falls
   *  back to a neutral edge color for internal / no-customer rows
   *  via the consumer; null/undefined skips the rail entirely. */
  customerRail?: string | null;
}

/**
 * A single <tr> in the entry table, plus an optional spanning edit row
 * rendered underneath it when `expanded` is true.
 *
 * Layout (category-first):
 *   [Category █ Name] [Project · Client — Description] [Duration] [$] [⋯]
 */
export function EntryRow({
  entry,
  projects,
  categories,
  expanded,
  onToggleExpand,
  columnCount,
  tzOffsetMin,
  selected,
  onToggleSelect,
  canRefresh = false,
  customerRail,
}: Props): React.JSX.Element {
  const t = useTranslations("time");
  const isRunning = !entry.end_time;
  const projectName = entry.projects?.name ?? "—";
  const customerName = entry.projects?.customers?.name ?? null;
  const customerId = entry.projects?.customers?.id ?? null;
  const projectIsInternal = entry.projects?.is_internal === true;
  const startDate = new Date(entry.start_time);
  const startTime = startDate.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const category = entry.category_id
    ? categories.find((c) => c.id === entry.category_id)
    : null;

  // Live-tick when running. Interval only binds while isRunning so we
  // don't burn cycles on every stopped row in the grid.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);
  const liveElapsed = (() => {
    const diff = Math.max(0, nowMs - startDate.getTime());
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  })();

  const rowClass = `border-b border-edge last:border-0 hover:bg-hover transition-colors cursor-pointer ${
    expanded ? "bg-surface-inset" : ""
  }`;

  return (
    <>
      <tr
        id={`entry-${entry.id}`}
        className={rowClass}
        onClick={() => onToggleExpand(entry.id)}
      >
        {/* Bulk-select checkbox — clicks here don't toggle the row
            expansion; they mutate the parent's selectedIds set. The
            optional customerRail draws a 4px band on the cell's left
            edge so the row visually connects to its customer
            sub-header above. */}
        <td
          className={`w-10 align-middle ${customerRail ? "border-l-4 pl-3" : "pl-4"}`}
          style={customerRail ? { borderLeftColor: customerRail } : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(entry.id)}
            aria-label={t("entry.select")}
            className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring cursor-pointer"
          />
        </td>
        {/* Category — hero column */}
        <td className="py-2.5 align-middle">
          {category ? (
            <div className="flex items-center gap-2 border-l-4 pl-3" style={{ borderColor: category.color }}>
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: category.color }}
              />
              <span className="text-body font-semibold text-content">
                {category.name}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-l-4 border-edge pl-3">
              <span className="h-2.5 w-2.5 rounded-full bg-content-muted shrink-0" />
              <span className="text-body text-content-muted italic">
                {t("entry.noCategory")}
              </span>
            </div>
          )}
        </td>

        {/* Project · Client + Description — truncated with Tooltips on
            hover so the full value is reachable per the MANDATORY
            tooltip rule for truncated content that conveys identity.
            Customer identity is rendered via CustomerChip per the
            Entity Identity rule (CLAUDE.md): square initials tile
            shared with the week view; internal projects get the
            Building glyph instead of a "?". */}
        <td className="px-3 py-2.5 align-middle min-w-0 max-w-0">
          <Tooltip
            label={
              customerName
                ? `${projectName} · ${customerName}`
                : projectIsInternal
                  ? `${projectName} · ${t("timesheet.row.internal")}`
                  : projectName
            }
          >
            <div className="flex items-center gap-1.5 text-caption text-content-secondary min-w-0">
              {customerName ? (
                <CustomerChip
                  customerId={customerId}
                  customerName={customerName}
                  size={14}
                />
              ) : projectIsInternal ? (
                <CustomerChip
                  customerId={null}
                  customerName={null}
                  internal
                  size={14}
                />
              ) : null}
              <span className="text-content truncate">{projectName}</span>
              {customerName && (
                <span className="text-content-muted truncate"> · {customerName}</span>
              )}
              {!customerName && projectIsInternal && (
                <span className="text-content-muted truncate">
                  {" "}
                  · {t("timesheet.row.internal")}
                </span>
              )}
            </div>
          </Tooltip>
          {(() => {
            const hasTicket = Boolean(
              entry.linked_ticket_provider && entry.linked_ticket_key,
            );
            // When a chip is present, it carries the key (and title via
            // tooltip) — repeating "AE-638: <full title>" right above
            // the chip is the redundancy the user flagged. Hide the
            // description text when:
            //   - the description is exactly the resolved title, OR
            //   - the description starts with `${key}:` (the imported
            //     "key: title" prefix), AND the rest matches the title.
            // Fall through and show the description when the user has
            // additional notes beyond the key+title.
            const description = entry.description ?? "";
            const title = entry.linked_ticket_title ?? "";
            const key = entry.linked_ticket_key ?? "";
            const trimmed = description.trim();
            const matchesTitle = title.length > 0 && trimmed === title;
            const matchesKeyTitle =
              title.length > 0 &&
              key.length > 0 &&
              trimmed === `${key}: ${title}`;
            const matchesKeyOnly =
              key.length > 0 && trimmed === `${key}:`.replace(/:$/, "");
            const hideDescription =
              hasTicket &&
              (matchesTitle || matchesKeyTitle || matchesKeyOnly);

            return (
              <>
                {!hideDescription &&
                  (description ? (
                    <Tooltip label={description}>
                      <div className="text-body text-content truncate mt-0.5">
                        {description}
                      </div>
                    </Tooltip>
                  ) : !hasTicket ? (
                    <div className="text-body text-content-muted italic truncate mt-0.5">
                      {t("entry.untitled")}
                    </div>
                  ) : null)}
                {(hasTicket || entry.invoiced) && (
                  <div className="mt-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                    {hasTicket && (
                      <TicketChip
                        entryId={entry.id}
                        provider={
                          entry.linked_ticket_provider as "jira" | "github"
                        }
                        ticketKey={entry.linked_ticket_key as string}
                        url={entry.linked_ticket_url}
                        title={entry.linked_ticket_title}
                        canRefresh={canRefresh}
                        size="sm"
                      />
                    )}
                    {entry.invoiced && entry.invoice_id && (
                      <InvoicedLockChip
                        invoiceId={entry.invoice_id}
                        invoiceNumber={entry.invoice_number}
                      />
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </td>

        {/* Author — per the MANDATORY authorship rule */}
        <td className="px-3 py-2.5 align-middle whitespace-nowrap">
          <EntryAuthor author={entry.author} size={20} />
        </td>

        {/* Start time (small, muted) */}
        <td className="px-3 py-2.5 align-middle whitespace-nowrap text-right">
          <span className="font-mono text-caption text-content-muted">
            {startTime}
          </span>
        </td>

        {/* Duration — live-ticks every second for running entries so the
            grid shows the elapsed clock, not a frozen "Running" label. */}
        <td className="px-3 py-2.5 align-middle text-right whitespace-nowrap">
          {isRunning ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-body-lg font-semibold text-success tabular-nums">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              {liveElapsed}
            </span>
          ) : (
            <span className="font-mono text-body-lg font-semibold text-content tabular-nums">
              {formatDurationHM(entry.duration_min)}
            </span>
          )}
        </td>

        {/* Billable */}
        <td className="px-2 py-2.5 align-middle text-center whitespace-nowrap">
          {entry.billable ? (
            <DollarSign size={14} className="inline text-success" />
          ) : (
            <Minus size={14} className="inline text-content-muted" />
          )}
        </td>

        <td
          className="px-2 py-2.5 align-middle text-right"
          onClick={(e) => e.stopPropagation()}
        >
          <EntryKebabMenu entry={entry} onEdit={() => onToggleExpand(entry.id)} />
        </td>
      </tr>

      {expanded && (
        <tr className="bg-surface-inset">
          <td
            colSpan={columnCount}
            className="px-4 py-3 border-b border-edge"
            onClick={(e) => e.stopPropagation()}
          >
            <InlineEditForm
              entry={entry}
              projects={projects}
              categories={categories}
              onDone={() => onToggleExpand(entry.id)}
              tzOffsetMin={tzOffsetMin}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Lock indicator chip — rendered next to the ticket chip (or on its
 * own) for entries that have been billed. Clickable; opens the
 * parent invoice in the same tab. Tooltip carries the long-form
 * "Locked — invoice <number>" affordance for the static row text.
 *
 * Three-channel signal per the redundant-encoding rule: lock icon
 * + "INV-<n>" text + accent-warning color. The DB trigger refuses
 * UPDATE/DELETE on these rows; the chip's purpose is to telegraph
 * that to the user before they hit "save" and get a backend error.
 */
function InvoicedLockChip({
  invoiceId,
  invoiceNumber,
}: {
  invoiceId: string;
  invoiceNumber: string | null;
}): React.JSX.Element {
  const t = useTranslations("time.lock");
  const label = invoiceNumber
    ? t("lockedOn", { invoice: invoiceNumber })
    : t("locked");
  return (
    <Tooltip label={label}>
      <Link
        href={`/invoices/${invoiceId}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning-soft/30 px-1.5 py-0.5 text-caption font-medium text-warning-text hover:border-warning/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning"
      >
        <Lock size={12} aria-hidden="true" />
        <span className="font-mono tabular-nums">
          {invoiceNumber ?? t("locked")}
        </span>
      </Link>
    </Tooltip>
  );
}
