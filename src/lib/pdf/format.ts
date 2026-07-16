/**
 * Shared @react-pdf/renderer formatting helpers, extracted verbatim from
 * InvoicePDF when ProposalPDF became the second consumer. PDF documents are
 * deliberately locale-agnostic (English labels, en-US number formatting) —
 * they're client-facing artifacts whose content must not shift with the
 * viewer's UI locale.
 */

import {
  deserializeAddress,
  formatAddressMultiLine,
} from "@/lib/schemas/address";

/** Currency formatter factory. Unknown ISO codes fall back to `CODE N.NN`. */
export function makeFmt(currency: string): (amount: number) => string {
  const code = (currency || "USD").toUpperCase();
  let formatter: Intl.NumberFormat | null;
  try {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    formatter = null;
  }
  return (amount: number): string =>
    formatter ? formatter.format(amount) : `${code} ${amount.toFixed(2)}`;
}

/**
 * Validate hex color string for @react-pdf/renderer. The DB CHECK constraint
 * already filters at write time, but defending here keeps a hand-built test
 * fixture or a stale cached value from blowing up a worker thread at PDF time.
 */
export function safeHex(color: string | null | undefined): string | null {
  if (!color) return null;
  return /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(color) ? color : null;
}

/** Parse a YYYY-MM-DD string (as UTC midnight) or a full ISO timestamp. */
export function parseDateOnly(iso: string): Date | null {
  const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(
      Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])),
    );
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** MM/DD/YYYY for the PDF. Date-only strings are calendar dates, not
 *  instants — print the parts straight so negative-offset locales don't
 *  shift them a day. */
export function formatPdfDate(iso: string | null): string {
  if (!iso) return "—";
  const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return `${dateOnly[2]}/${dateOnly[3]}/${dateOnly[1]}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Filter the country line out of an address's display lines unless the
 * caller explicitly wants it. `formatAddressMultiLine` returns
 * `[street, "city, state zip", country]` with country at the tail when
 * present. Hidden by default — the country line reads as noise on domestic
 * documents, which is ~90% of the volume.
 */
export function addressLinesForBlock(
  addressJson: string | null,
  showCountry: boolean,
): string[] {
  const all = formatAddressMultiLine(deserializeAddress(addressJson));
  if (showCountry) return all;
  // Trim only when there are 2+ lines — a legacy plain-text address returns
  // a single line we must not drop. With 2+ lines, the country (when
  // present) is always last and never contains a comma; the city/state/zip
  // line always does.
  if (all.length < 2) return all;
  const last = all[all.length - 1];
  if (last && !last.includes(",")) return all.slice(0, -1);
  return all;
}
