"use client";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
  },
  invoiceTitle: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    color: "#2563eb",
    letterSpacing: 2,
  },
  invoiceNumber: {
    fontSize: 12,
    color: "#4b5563",
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#9ca3af",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    marginBottom: 4,
  },
  companyName: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  detailText: {
    fontSize: 10,
    color: "#4b5563",
    marginBottom: 1,
  },
  addressBlock: {
    marginBottom: 20,
  },
  datesRow: {
    flexDirection: "row",
    gap: 40,
    marginBottom: 20,
  },
  dateLabel: {
    fontSize: 8,
    color: "#9ca3af",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  dateValue: {
    fontSize: 10,
    marginTop: 2,
  },
  table: {
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingBottom: 6,
    marginBottom: 6,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f3f4f6",
  },
  colDescription: { flex: 3 },
  colQty: { flex: 1, textAlign: "right" as const },
  colRate: { flex: 1, textAlign: "right" as const },
  colAmount: { flex: 1, textAlign: "right" as const },
  headerText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#9ca3af",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  cellText: {
    fontSize: 10,
    color: "#111827",
  },
  cellMuted: {
    fontSize: 10,
    color: "#4b5563",
  },
  totalsSection: {
    alignItems: "flex-end",
    marginTop: 10,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 40,
    paddingVertical: 3,
  },
  totalLabel: {
    fontSize: 10,
    color: "#4b5563",
    width: 80,
    textAlign: "right" as const,
  },
  totalValue: {
    fontSize: 10,
    fontFamily: "Helvetica",
    width: 80,
    textAlign: "right" as const,
  },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 40,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#111827",
    marginTop: 4,
  },
  grandTotalLabel: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    width: 80,
    textAlign: "right" as const,
  },
  grandTotalValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    width: 80,
    textAlign: "right" as const,
  },
  notes: {
    marginTop: 30,
    padding: 12,
    backgroundColor: "#f9fafb",
    borderRadius: 4,
  },
  notesTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#9ca3af",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    marginBottom: 4,
  },
  notesText: {
    fontSize: 10,
    color: "#4b5563",
    lineHeight: 1.5,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 9,
    color: "#9ca3af",
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

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{invoiceNumber}</Text>
          </View>
          <View style={{ alignItems: "flex-end" as const }}>
            <Text style={styles.companyName}>
              {business.name ?? ""}
            </Text>
            {business.email && (
              <Text style={styles.detailText}>{business.email}</Text>
            )}
            {business.phone && (
              <Text style={styles.detailText}>{business.phone}</Text>
            )}
            {business.address && (
              <Text style={styles.detailText}>{business.address}</Text>
            )}
          </View>
        </View>

        {/* Bill To */}
        <View style={styles.addressBlock}>
          <Text style={styles.sectionTitle}>Bill To</Text>
          <Text style={styles.companyName}>{client.name}</Text>
          {client.email && (
            <Text style={styles.detailText}>{client.email}</Text>
          )}
          {client.address && (
            <Text style={styles.detailText}>{client.address}</Text>
          )}
        </View>

        {/* Dates */}
        <View style={styles.datesRow}>
          <View>
            <Text style={styles.dateLabel}>Date</Text>
            <Text style={styles.dateValue}>
              {issuedDate
                ? new Date(issuedDate).toLocaleDateString()
                : "—"}
            </Text>
          </View>
          <View>
            <Text style={styles.dateLabel}>Due Date</Text>
            <Text style={styles.dateValue}>
              {dueDate
                ? new Date(dueDate).toLocaleDateString()
                : "—"}
            </Text>
          </View>
        </View>

        {/* Line items table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.headerText, styles.colDescription]}>
              Description
            </Text>
            <Text style={[styles.headerText, styles.colQty]}>Qty</Text>
            <Text style={[styles.headerText, styles.colRate]}>Rate</Text>
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
        <View style={styles.totalsSection}>
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
          <View style={styles.grandTotal}>
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

        {/* Footer */}
        <Text style={styles.footer}>Thank you for your business.</Text>
      </Page>
    </Document>
  );
}
