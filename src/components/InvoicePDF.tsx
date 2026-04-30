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
const ruleSofter = "#f3f4f6";

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 56,
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
    marginBottom: 36,
  },
  brandMark: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: ink,
    letterSpacing: -0.5,
  },
  fromBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    maxWidth: 240,
  },
  fromLabel: {
    fontSize: 10,
    color: inkMuted,
    paddingTop: 1,
  },
  fromDivider: {
    width: 1,
    backgroundColor: ruleSoft,
    alignSelf: "stretch",
  },
  fromBody: {
    flexDirection: "column" as const,
  },
  fromName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: ink,
    marginBottom: 2,
  },
  fromLine: {
    fontSize: 10,
    color: inkSecondary,
  },

  // Meta band: Invoice ID / Issue Date / Due Date on the left,
  // Invoice For on the right.
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 28,
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
  invoiceForBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    maxWidth: 240,
  },
  invoiceForLabel: {
    fontSize: 10,
    color: inkMuted,
    paddingTop: 1,
  },
  invoiceForBody: {
    flexDirection: "column" as const,
  },
  invoiceForName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: ink,
    marginBottom: 2,
  },
  invoiceForLine: {
    fontSize: 10,
    color: inkSecondary,
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
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: ruleSofter,
  },
  colDescription: { flex: 4, paddingRight: 8 },
  colQty: { flex: 1, textAlign: "right" as const, paddingRight: 8 },
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
    fontFamily: "Helvetica-Bold",
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
});

export interface InvoicePDFProps {
  invoiceNumber: string;
  issuedDate: string | null;
  dueDate: string | null;
  notes: string | null;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  /** ISO 4217 currency code. Defaults to USD when omitted so legacy
   *  rows without a currency value still render. */
  currency?: string;
  business: {
    name: string | null;
    email: string | null;
    address: string | null;
    phone: string | null;
  };
  client: {
    name: string;
    email: string | null;
    address: string | null;
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

export function InvoicePDF(props: InvoicePDFProps): React.JSX.Element {
  const {
    invoiceNumber,
    issuedDate,
    dueDate,
    notes,
    subtotal,
    taxRate,
    taxAmount,
    total,
    currency,
    business,
    client,
    lineItems,
  } = props;
  const fmt = makeFmt(currency ?? "USD");
  const businessAddressLines = formatAddressMultiLine(
    deserializeAddress(business.address),
  );
  const clientAddressLines = formatAddressMultiLine(
    deserializeAddress(client.address),
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header: brand mark left, From block right */}
        <View style={styles.header}>
          <Text style={styles.brandMark}>{business.name ?? ""}</Text>
          <View style={styles.fromBlock}>
            <Text style={styles.fromLabel}>From</Text>
            <View style={styles.fromDivider} />
            <View style={styles.fromBody}>
              <Text style={styles.fromName}>{business.name ?? ""}</Text>
              {businessAddressLines.map((line, i) => (
                <Text key={i} style={styles.fromLine}>
                  {line}
                </Text>
              ))}
              {business.email && (
                <Text style={styles.fromLine}>{business.email}</Text>
              )}
              {business.phone && (
                <Text style={styles.fromLine}>{business.phone}</Text>
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
              <Text style={styles.metaValue}>{formatPdfDate(dueDate)}</Text>
            </View>
          </View>
          <View style={styles.invoiceForBlock}>
            <Text style={styles.invoiceForLabel}>Invoice For</Text>
            <View style={styles.fromDivider} />
            <View style={styles.invoiceForBody}>
              <Text style={styles.invoiceForName}>{client.name}</Text>
              {clientAddressLines.map((line, i) => (
                <Text key={i} style={styles.invoiceForLine}>
                  {line}
                </Text>
              ))}
              {client.email && (
                <Text style={styles.invoiceForLine}>{client.email}</Text>
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
            <Text style={[styles.headerText, styles.colQty]}>Quantity</Text>
            <Text style={[styles.headerText, styles.colRate]}>Unit Price</Text>
            <Text style={[styles.headerText, styles.colAmount]}>Amount</Text>
          </View>
          {lineItems.map((item, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={[styles.cellText, styles.colDescription]}>
                {item.description}
              </Text>
              <Text style={[styles.cellMuted, styles.colQty]}>
                {item.quantity.toFixed(2)}
              </Text>
              <Text style={[styles.cellMuted, styles.colRate]}>
                {fmt(item.unitPrice)}
              </Text>
              <Text style={[styles.cellText, styles.colAmount]}>
                {fmt(item.amount)}
              </Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{fmt(subtotal)}</Text>
          </View>
          {taxRate > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax ({taxRate}%)</Text>
              <Text style={styles.totalValue}>{fmt(taxAmount)}</Text>
            </View>
          )}
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={styles.grandTotalValue}>{fmt(total)}</Text>
          </View>
        </View>

        {/* Notes */}
        {notes && (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text style={styles.notesText}>{notes}</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}
