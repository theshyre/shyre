"use client";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import {
  deserializeAddress,
  formatAddressMultiLine,
} from "@/lib/schemas/address";

// Color palette. Hex (not CSS vars) because @react-pdf/renderer
// runs in a worker and can't read the document's custom properties.
// Kept deliberately neutral — brand-color customization is a
// follow-up; for now the business name acts as the brand mark via
// weight + size, not hue.
const ink = "#111827";
const inkSecondary = "#374151";
const inkMuted = "#6b7280";
const inkFaint = "#9ca3af";
const ruleSoft = "#e5e7eb";
const zebraBg = "#f7f7f7";

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: ink,
    lineHeight: 1.4,
  },

  // Header: brand mark on the left, From block on the right.
  // Business name renders large to act as the brand mark when no
  // logo is configured. Mirrors the Harvest layout that put the
  // logo upper-left and "From | Company | Address" upper-right.
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 28,
  },
  brandMark: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: ink,
    letterSpacing: -0.5,
  },
  // From / Invoice For shared block. Fixed width so both stack
  // identically on the right column, and a fixed-width label so
  // the body's left edge aligns across "From" (4 chars) and
  // "Invoice For" (11 chars).
  rightBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    width: 240,
  },
  rightLabel: {
    fontSize: 10,
    color: inkMuted,
    width: 56,
    paddingTop: 1,
  },
  rightBody: {
    flexDirection: "column" as const,
    flex: 1,
  },
  rightName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: ink,
    marginBottom: 2,
  },
  rightLine: {
    fontSize: 10,
    color: inkSecondary,
  },

  // Meta band: Invoice ID / Issue Date / Due Date on the left,
  // Invoice For on the right. Top-aligned so the date column and
  // customer name sit at the same y.
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  metaLeft: {
    flexDirection: "column" as const,
    gap: 4,
  },
  metaPair: {
    flexDirection: "row",
    gap: 16,
  },
  metaKey: {
    fontSize: 10,
    color: inkMuted,
    width: 72,
  },
  metaValue: {
    fontSize: 10,
    color: ink,
  },
  metaValueBold: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: ink,
  },

  // Line-items table.
  table: {
    marginTop: 4,
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: ruleSoft,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tableRowZebra: {
    backgroundColor: zebraBg,
  },
  colDescription: { flex: 4, paddingRight: 8 },
  colHours: { flex: 1, textAlign: "right" as const, paddingRight: 8 },
  colRate: { flex: 1.2, textAlign: "right" as const, paddingRight: 8 },
  colAmount: { flex: 1.2, textAlign: "right" as const },
  headerText: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: ink,
  },
  cellText: {
    fontSize: 10,
    color: ink,
  },
  cellMuted: {
    fontSize: 10,
    color: inkSecondary,
  },
  // Mono font on numeric columns so decimals stack vertically.
  // Helvetica's `tabular-nums` doesn't exist in @react-pdf/renderer;
  // built-in Courier is the cheapest path to column alignment.
  cellMono: {
    fontFamily: "Courier",
  },

  // Totals — right-aligned column with label/value pairs.
  totalsBlock: {
    alignSelf: "flex-end",
    width: 240,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  totalLabel: {
    fontSize: 10,
    color: inkSecondary,
  },
  totalValue: {
    fontSize: 10,
    color: ink,
    fontFamily: "Courier",
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: ink,
  },
  grandTotalLabel: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: ink,
  },
  grandTotalValue: {
    fontSize: 12,
    fontFamily: "Courier-Bold",
    color: ink,
  },

  // Notes.
  notes: {
    marginTop: 28,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: ruleSoft,
  },
  notesTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: inkFaint,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    marginBottom: 6,
  },
  notesText: {
    fontSize: 10,
    color: inkSecondary,
    lineHeight: 1.5,
  },

  // Page footer ("Page X of Y"). Fixed-bottom so it appears on
  // every page when the line items wrap.
  footer: {
    position: "absolute",
    bottom: 18,
    left: 36,
    right: 36,
    textAlign: "center" as const,
    fontSize: 9,
    color: inkFaint,
  },
});

export interface InvoicePDFProps {
  invoiceNumber: string;
  issuedDate: string | null;
  dueDate: string | null;
  notes: string | null;
  subtotal: number;
  /** Status flips the watermark + the totals' grand-total label.
   *  Defaults to draft when omitted (legacy callers). */
  status?: string;
  /** Dollar discount applied to this invoice. Surfaces a
   *  "Discount" line in the totals block when > 0. */
  discountAmount?: number;
  /** Percentage 0-100 if the user typed a rate; null/undefined for
   *  flat-amount discounts. Display-only — appended to the
   *  Discount label as " (10%)". */
  discountRate?: number | null;
  taxRate: number;
  taxAmount: number;
  total: number;
  /** Sum of recorded payments. Surfaces the "Subtotal / Payments /
   *  Amount Due" rollup in the totals block when > 0. Default 0
   *  preserves the current "Subtotal / Tax / Total" output for
   *  unpaid invoices. */
  paymentsTotal?: number;
  /** Denormalized payment-terms label ("Net 30", "Due on receipt").
   *  Prefer this when present — it's frozen at create-time. Falls
   *  back to the date-diff heuristic for legacy invoices that
   *  pre-date the payment_terms_label column. */
  paymentTermsLabel?: string | null;
  /** ISO 4217 currency code. Defaults to USD when omitted so legacy
   *  rows without a currency value still render. */
  currency?: string;
  business: {
    name: string | null;
    email: string | null;
    address: string | null;
    phone: string | null;
    /** Two-tone wordmark + accent color from team_settings. When
     *  null, falls back to `name` rendered in default ink. */
    wordmarkPrimary?: string | null;
    wordmarkSecondary?: string | null;
    brandColor?: string | null;
    /** team_settings.show_country_on_invoice. Suppresses the
     *  country line in the From block when false (default). */
    showCountry?: boolean;
  };
  client: {
    name: string;
    email: string | null;
    address: string | null;
    /** customers.show_country_on_invoice. Independent of the
     *  team's toggle — a US team invoicing a UK customer will
     *  often suppress From's country and show the customer's. */
    showCountry?: boolean;
  };
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
}

function makeFmt(currency: string): (amount: number) => string {
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
 * Validate hex color string for @react-pdf/renderer. The DB CHECK
 * constraint already filters at write time, but defending here keeps
 * a hand-built test fixture or a stale cached value from blowing up
 * a worker thread at PDF time.
 */
function safeHex(color: string | null | undefined): string | null {
  if (!color) return null;
  return /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(color) ? color : null;
}

/**
 * Days between two YYYY-MM-DD strings (or ISO timestamps), used to
 * show "(Net 30)" alongside the due date when the gap is a familiar
 * payment-term value (Net 7/14/15/30/45/60/90). Falls back to no
 * label when the gap doesn't match a standard term — Harvest only
 * renders the badge for canonical terms too.
 */
function netLabelForDateRange(
  issuedIso: string | null,
  dueIso: string | null,
): string | null {
  if (!issuedIso || !dueIso) return null;
  const a = parseDateOnly(issuedIso);
  const b = parseDateOnly(dueIso);
  if (!a || !b) return null;
  const diff = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  const NET_TERMS = new Set([7, 14, 15, 30, 45, 60, 90]);
  return NET_TERMS.has(diff) ? `Net ${diff}` : null;
}

function parseDateOnly(iso: string): Date | null {
  const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(
      Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])),
    );
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatPdfDate(iso: string | null): string {
  if (!iso) return "—";
  // Date-only strings ("YYYY-MM-DD") parse as UTC midnight, which
  // can render as the previous day in negative-offset locales. The
  // value is a calendar date, not an instant — split the parts and
  // print them straight.
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
 * Filter the country line out of an address's display lines unless
 * the caller explicitly wants it. `formatAddressMultiLine` returns
 * `[street, "city, state zip", country]` with country at the tail
 * when present. Hide it by default — the country line reads as
 * noise on domestic invoices, which is ~90% of the volume. The
 * `showCountry` toggle is per-block so a US team can show the
 * customer's country without showing their own.
 */
function addressLinesForBlock(
  addressJson: string | null,
  showCountry: boolean,
): string[] {
  const all = formatAddressMultiLine(deserializeAddress(addressJson));
  if (showCountry) return all;
  // Trim only when there are 2+ lines — `formatAddressMultiLine`
  // returns a single line for legacy plain-text addresses (just
  // street), and we don't want to drop their only line. With 2+
  // lines, the country (when present) is always last and never
  // contains a comma; the city/state/zip line always does.
  if (all.length < 2) return all;
  const last = all[all.length - 1];
  if (last && !last.includes(",")) return all.slice(0, -1);
  return all;
}

export function InvoicePDF(props: InvoicePDFProps): React.JSX.Element {
  const {
    invoiceNumber,
    issuedDate,
    dueDate,
    notes,
    subtotal,
    status,
    discountAmount = 0,
    discountRate = null,
    taxRate,
    taxAmount,
    total,
    paymentsTotal = 0,
    paymentTermsLabel,
    currency,
    business,
    client,
    lineItems,
  } = props;
  const fmt = makeFmt(currency ?? "USD");
  const businessAddressLines = addressLinesForBlock(
    business.address,
    business.showCountry ?? false,
  );
  const clientAddressLines = addressLinesForBlock(
    client.address,
    client.showCountry ?? false,
  );

  // Two-tone wordmark with optional brand color. Falls back to
  // business.name in default ink — preserves the original brand-mark
  // shape for teams that haven't configured branding yet.
  const accentColor = safeHex(business.brandColor) ?? ink;
  const primaryWordmark = business.wordmarkPrimary ?? business.name ?? "";
  const secondaryWordmark = business.wordmarkSecondary ?? "";

  // Payment-terms label. Prefer the denormalized invoice column
  // (frozen at create-time) so changing customer/team defaults
  // doesn't retroactively alter sent invoices. Fall back to the
  // date-diff heuristic for legacy invoices created before the
  // payment_terms_label column existed.
  const netLabel =
    paymentTermsLabel?.trim() ||
    netLabelForDateRange(issuedDate, dueDate);
  const dueDateText = netLabel
    ? `${formatPdfDate(dueDate)} (${netLabel})`
    : formatPdfDate(dueDate);

  // Amount due = total - payments. Clamp at 0 so over-payments don't
  // render as a negative number (refund handling is out of scope).
  const amountDue = Math.max(0, total - paymentsTotal);
  const showPaymentsRollup = paymentsTotal > 0;
  // Bottom-row label: "Amount Due" unconditionally now. Earlier code
  // only flipped to "Amount Due" when payments were present, leaving
  // unpaid invoices labeled "Total" — confusing for AP teams who key
  // on "Amount Due" as the field they'll cut a check against.
  const grandTotalAmount = showPaymentsRollup ? amountDue : total;

  // The PDF deliberately doesn't render a PAID / VOID watermark.
  // Harvest's reference PDF doesn't either — the paid signal is
  // carried by the totals block ("Payments / Amount Due $0.00"),
  // and a rotated stamp at PDF resolution overlaps the line items
  // table at common page sizes. The web detail page still renders
  // the watermark since it has a viewport-aware container; PDF
  // print surfaces stay clean.
  // `status` arrives in props but we don't act on it here today —
  // kept for forward compatibility (e.g. a future "DRAFT" footer).
  void status;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header: branded wordmark left, From block right */}
        <View style={styles.header}>
          <Text style={styles.brandMark}>
            <Text style={{ color: accentColor }}>{primaryWordmark}</Text>
            {secondaryWordmark ? <Text>{secondaryWordmark}</Text> : null}
          </Text>
          <View style={styles.rightBlock}>
            <Text style={styles.rightLabel}>From</Text>
            <View style={styles.rightBody}>
              <Text style={styles.rightName}>{business.name ?? ""}</Text>
              {businessAddressLines.map((line, i) => (
                <Text key={i} style={styles.rightLine}>
                  {line}
                </Text>
              ))}
              {business.email && (
                <Text style={styles.rightLine}>{business.email}</Text>
              )}
              {business.phone && (
                <Text style={styles.rightLine}>{business.phone}</Text>
              )}
            </View>
          </View>
        </View>

        {/* Meta + Invoice For */}
        <View style={styles.metaRow}>
          <View style={styles.metaLeft}>
            <View style={styles.metaPair}>
              <Text style={styles.metaKey}>Invoice ID</Text>
              <Text style={styles.metaValueBold}>{invoiceNumber}</Text>
            </View>
            <View style={styles.metaPair}>
              <Text style={styles.metaKey}>Issue Date</Text>
              <Text style={styles.metaValue}>{formatPdfDate(issuedDate)}</Text>
            </View>
            <View style={styles.metaPair}>
              <Text style={styles.metaKey}>Due Date</Text>
              <Text style={styles.metaValue}>{dueDateText}</Text>
            </View>
          </View>
          <View style={styles.rightBlock}>
            <Text style={styles.rightLabel}>Invoice For</Text>
            <View style={styles.rightBody}>
              <Text style={styles.rightName}>{client.name}</Text>
              {clientAddressLines.map((line, i) => (
                <Text key={i} style={styles.rightLine}>
                  {line}
                </Text>
              ))}
              {client.email && (
                <Text style={styles.rightLine}>{client.email}</Text>
              )}
            </View>
          </View>
        </View>

        {/* Line items */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.headerText, styles.colDescription]}>
              Description
            </Text>
            <Text style={[styles.headerText, styles.colHours]}>Hours</Text>
            <Text style={[styles.headerText, styles.colRate]}>Rate</Text>
            <Text style={[styles.headerText, styles.colAmount]}>Amount</Text>
          </View>
          {lineItems.map((item, i) => (
            <View
              key={i}
              style={[
                styles.tableRow,
                i % 2 === 1 ? styles.tableRowZebra : {},
              ]}
            >
              <Text style={[styles.cellText, styles.colDescription]}>
                {item.description}
              </Text>
              <Text
                style={[styles.cellMuted, styles.colHours, styles.cellMono]}
              >
                {item.quantity.toFixed(2)}
              </Text>
              <Text
                style={[styles.cellMuted, styles.colRate, styles.cellMono]}
              >
                {fmt(item.unitPrice)}
              </Text>
              <Text
                style={[styles.cellText, styles.colAmount, styles.cellMono]}
              >
                {fmt(item.amount)}
              </Text>
            </View>
          ))}
        </View>

        {/* Totals.
            Order: Subtotal / Discount? / Tax? / Payments? / grand total.
            Grand total label is always "Amount Due" so AP teams have
            a stable field to key on. Discount line uses parentheses
            (accounting convention) instead of a hyphen-minus so it
            survives fax / scan / copy-paste. */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{fmt(subtotal)}</Text>
          </View>
          {discountAmount > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>
                {discountRate !== null && discountRate !== undefined
                  ? `Discount (${discountRate}%)`
                  : "Discount"}
              </Text>
              <Text style={styles.totalValue}>({fmt(discountAmount)})</Text>
            </View>
          )}
          {taxRate > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax ({taxRate}%)</Text>
              <Text style={styles.totalValue}>{fmt(taxAmount)}</Text>
            </View>
          )}
          {showPaymentsRollup && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Payments</Text>
              <Text style={styles.totalValue}>({fmt(paymentsTotal)})</Text>
            </View>
          )}
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Amount Due</Text>
            <Text style={styles.grandTotalValue}>
              {fmt(grandTotalAmount)}
            </Text>
          </View>
        </View>

        {/* Notes */}
        {notes && (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text style={styles.notesText}>{notes}</Text>
          </View>
        )}

        {/* Page footer — Harvest convention. `fixed` makes it render
            on every page when line items spill across pages. */}
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}
