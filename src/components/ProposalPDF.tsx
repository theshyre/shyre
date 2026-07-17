"use client";

import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import { MarkdownPdf } from "@/components/markdown-pdf";
import {
  makeFmt,
  safeHex,
  formatPdfDate,
  addressLinesForBlock,
} from "@/lib/pdf/format";

// Same neutral palette as InvoicePDF — hex, not CSS vars, because the
// renderer runs in a worker. Labels are deliberately English/locale-agnostic,
// matching the invoice-PDF convention for client-facing documents.
const ink = "#111827";
const inkSecondary = "#374151";
const inkMuted = "#6b7280";
const inkFaint = "#9ca3af";
const ruleSoft = "#e5e7eb";

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: ink,
    lineHeight: 1.4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  brandMark: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: ink,
    letterSpacing: -0.5,
  },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: {
    // Cap the height so a tall logo can't blow out the header; width scales.
    maxHeight: 44,
    maxWidth: 200,
    objectFit: "contain",
  },
  clientLogo: {
    maxHeight: 28,
    maxWidth: 120,
    marginBottom: 4,
    objectFit: "contain",
  },
  rightBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    width: 240,
  },
  rightLabel: {
    fontSize: 10,
    color: inkMuted,
    width: 68,
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
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
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
  docTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: ink,
    marginBottom: 16,
  },
  overview: {
    marginBottom: 16,
  },
  summary: {
    marginBottom: 16,
  },
  sumHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: ink,
    paddingBottom: 3,
    marginBottom: 2,
  },
  sumRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: ruleSoft,
    paddingVertical: 3,
  },
  sumTotalRow: { flexDirection: "row", paddingTop: 4 },
  sumNum: { width: 16, fontSize: 9, color: inkSecondary },
  sumProject: {
    flex: 3,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: ink,
    paddingRight: 6,
  },
  sumWhat: { flex: 5, fontSize: 9, color: inkSecondary, paddingRight: 6 },
  sumPrice: {
    width: 60,
    fontSize: 9,
    fontFamily: "Courier",
    color: ink,
    textAlign: "right",
  },
  sumHead: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: inkFaint,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sumTotalLabel: {
    flex: 1,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: ink,
    textAlign: "right",
    paddingRight: 6,
  },

  // ---- line items
  itemBlock: {
    borderTopWidth: 0.5,
    borderTopColor: ruleSoft,
    paddingTop: 12,
    marginBottom: 16,
  },
  itemHeadRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  // Physical tick-box so paper signers can mark the items they authorize —
  // the print analog of the selectable-subset acceptance.
  checkbox: {
    width: 11,
    height: 11,
    borderWidth: 1,
    borderColor: ink,
    marginTop: 1,
  },
  itemTitle: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: ink,
  },
  itemPrice: {
    fontSize: 12,
    fontFamily: "Courier-Bold",
    color: ink,
  },
  itemBody: {
    marginTop: 6,
    paddingLeft: 19,
  },
  fieldLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: inkFaint,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
    marginTop: 6,
    marginBottom: 1,
  },
  fieldText: {
    fontSize: 10,
    color: inkSecondary,
  },
  phaseRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    paddingLeft: 12,
  },
  phaseTitle: {
    fontSize: 10,
    color: inkSecondary,
  },
  phasePrice: {
    fontSize: 10,
    fontFamily: "Courier",
    color: inkSecondary,
  },
  cappedNote: {
    fontSize: 8,
    color: inkMuted,
    paddingLeft: 12,
    marginTop: 2,
  },

  // ---- totals + terms
  totalsBlock: {
    alignSelf: "flex-end",
    width: 260,
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: ink,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  totalLabel: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: ink,
  },
  totalValue: {
    fontSize: 12,
    fontFamily: "Courier-Bold",
    color: ink,
  },
  selectableNote: {
    marginTop: 10,
    fontSize: 9,
    color: inkMuted,
    lineHeight: 1.5,
  },
  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: inkFaint,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 6,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: ruleSoft,
  },
  termRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 3,
  },
  termKey: {
    fontSize: 10,
    color: inkMuted,
    width: 110,
  },
  termValue: {
    fontSize: 10,
    color: ink,
  },
  termsNotesText: {
    fontSize: 10,
    color: inkSecondary,
    lineHeight: 1.5,
    marginTop: 4,
  },

  // ---- acceptance / signature block
  acceptanceNote: {
    fontSize: 10,
    color: inkSecondary,
    lineHeight: 1.5,
    marginBottom: 14,
  },
  signatureRow: {
    flexDirection: "row",
    gap: 24,
  },
  signatureCol: {
    flex: 1,
  },
  signatureColTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: ink,
    marginBottom: 12,
  },
  signatureLine: {
    borderBottomWidth: 0.75,
    borderBottomColor: ink,
    marginTop: 20,
    marginBottom: 3,
  },
  signatureCaption: {
    fontSize: 8,
    color: inkMuted,
  },

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

export interface ProposalPDFItem {
  title: string;
  summary: string | null;
  bodyMarkdown: string | null;
  description: string | null;
  whyItMatters: string | null;
  outOfScope: string | null;
  definitionOfDone: string | null;
  fixedPrice: number;
  isCapped: boolean;
  phases: Array<{ title: string; description: string | null; fixedPrice: number }>;
}

export interface ProposalPDFProps {
  proposalNumber: string;
  title: string;
  overviewMarkdown?: string | null;
  issuedDate: string | null;
  validUntil: string | null;
  /** Frozen at authoring time ("Net 30" / "Due on receipt"), or null. */
  paymentTermsLabel: string | null;
  depositType: "none" | "percent" | "amount";
  depositValue: number | null;
  warrantyDays: number | null;
  termsNotes: string | null;
  /** Sum of top-level fixed prices. */
  total: number;
  currency?: string;
  business: {
    name: string | null;
    email: string | null;
    address: string | null;
    phone: string | null;
    wordmarkPrimary?: string | null;
    wordmarkSecondary?: string | null;
    brandColor?: string | null;
    /** PNG/JPEG logo pre-resolved to a data URI (see fetchImageAsDataUri).
     *  When set it renders in place of the text wordmark. */
    logoDataUri?: string | null;
    showCountry?: boolean;
  };
  client: {
    name: string;
    email: string | null;
    address: string | null;
    showCountry?: boolean;
    /** Customer co-brand: an optional accent hex + PNG/JPEG logo data URI,
     *  rendered in the "Prepared for" block alongside the team's own brand. */
    accentColor?: string | null;
    logoDataUri?: string | null;
  };
  /** Intended signer's display name, printed under the client block. */
  signerName?: string | null;
  /** Multi-signer roster names — when 2+, the acceptance block prints a
   *  signature column per signer (titled with their name) instead of a single
   *  generic "Client" column. */
  signerNames?: string[];
  items: ProposalPDFItem[];
}

function depositText(
  depositType: ProposalPDFProps["depositType"],
  depositValue: number | null,
  fmt: (n: number) => string,
): string | null {
  if (depositType === "none" || depositValue == null) return null;
  if (depositType === "percent") return `${depositValue}% of accepted total`;
  return `${fmt(depositValue)} up front`;
}

export function ProposalPDF(props: ProposalPDFProps): React.JSX.Element {
  const {
    proposalNumber,
    title,
    overviewMarkdown,
    issuedDate,
    validUntil,
    paymentTermsLabel,
    depositType,
    depositValue,
    warrantyDays,
    termsNotes,
    total,
    currency,
    business,
    client,
    signerName,
    items,
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
  const accentColor = safeHex(business.brandColor) ?? ink;
  const clientAccent = safeHex(client.accentColor);
  const summaryHasWhat = items.some(
    (i) => i.summary && i.summary.trim() !== "",
  );
  const primaryWordmark = business.wordmarkPrimary ?? business.name ?? "";
  const secondaryWordmark = business.wordmarkSecondary ?? "";
  const deposit = depositText(depositType, depositValue, fmt);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header — identical shape to the invoice PDF */}
        <View style={styles.header}>
          {/* Brand lockup: logo AND wordmark side by side (either alone if only
              one is set; the business name is the last-resort mark). */}
          <View style={styles.brandLockup}>
            {business.logoDataUri ? (
              // @react-pdf Image is a PDF primitive, not an HTML <img> — no alt.
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={business.logoDataUri} style={styles.logo} />
            ) : null}
            {business.wordmarkPrimary ? (
              <Text style={styles.brandMark}>
                <Text style={{ color: accentColor }}>
                  {business.wordmarkPrimary}
                </Text>
                {secondaryWordmark ? <Text>{secondaryWordmark}</Text> : null}
              </Text>
            ) : business.logoDataUri ? null : (
              <Text style={styles.brandMark}>{primaryWordmark}</Text>
            )}
          </View>
          <View style={styles.rightBlock}>
            <Text style={styles.rightLabel}>Prepared by</Text>
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

        {/* Meta + Prepared For */}
        <View style={styles.metaRow}>
          <View style={styles.metaLeft}>
            <View style={styles.metaPair}>
              <Text style={styles.metaKey}>Proposal ID</Text>
              <Text style={styles.metaValueBold}>{proposalNumber}</Text>
            </View>
            <View style={styles.metaPair}>
              <Text style={styles.metaKey}>Issue Date</Text>
              <Text style={styles.metaValue}>{formatPdfDate(issuedDate)}</Text>
            </View>
            <View style={styles.metaPair}>
              <Text style={styles.metaKey}>Valid Until</Text>
              <Text style={styles.metaValue}>{formatPdfDate(validUntil)}</Text>
            </View>
          </View>
          <View style={styles.rightBlock}>
            <Text style={styles.rightLabel}>Prepared for</Text>
            <View style={styles.rightBody}>
              {client.logoDataUri ? (
                // @react-pdf Image, not an HTML <img>.
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image src={client.logoDataUri} style={styles.clientLogo} />
              ) : null}
              <Text
                style={
                  clientAccent
                    ? { ...styles.rightName, color: clientAccent }
                    : styles.rightName
                }
              >
                {client.name}
              </Text>
              {signerName ? (
                <Text style={styles.rightLine}>Attn: {signerName}</Text>
              ) : null}
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

        <Text style={styles.docTitle}>{title}</Text>

        {overviewMarkdown && overviewMarkdown.trim() !== "" ? (
          <View style={styles.overview}>
            <MarkdownPdf content={overviewMarkdown} />
          </View>
        ) : null}

        {/* Auto summary / pricing table (2+ items). */}
        {items.length >= 2 ? (
          <View style={styles.summary}>
            <Text style={styles.sectionTitle}>Summary</Text>
            <View style={styles.sumHeaderRow}>
              <Text style={[styles.sumNum, styles.sumHead]}>#</Text>
              <Text style={[styles.sumProject, styles.sumHead]}>Project</Text>
              {summaryHasWhat ? (
                <Text style={[styles.sumWhat, styles.sumHead]}>
                  What it does for you
                </Text>
              ) : null}
              <Text style={[styles.sumPrice, styles.sumHead]}>Price</Text>
            </View>
            {items.map((item, i) => (
              <View key={i} style={styles.sumRow}>
                <Text style={styles.sumNum}>{i + 1}</Text>
                <Text style={styles.sumProject}>{item.title}</Text>
                {summaryHasWhat ? (
                  <Text style={styles.sumWhat}>{item.summary ?? ""}</Text>
                ) : null}
                <Text style={styles.sumPrice}>{fmt(item.fixedPrice)}</Text>
              </View>
            ))}
            <View style={styles.sumTotalRow}>
              <Text style={styles.sumTotalLabel}>All items</Text>
              <Text style={styles.sumPrice}>{fmt(total)}</Text>
            </View>
          </View>
        ) : null}

        {/* Line items — each with a physical tick-box so a paper signer can
            mark the subset they authorize. */}
        {items.map((item, i) => (
          <View key={i} style={styles.itemBlock}>
            <View style={styles.itemHeadRow}>
              <View style={styles.checkbox} />
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text style={styles.itemPrice}>{fmt(item.fixedPrice)}</Text>
            </View>
            <View style={styles.itemBody}>
              {item.bodyMarkdown && item.bodyMarkdown.trim() !== "" ? (
                <MarkdownPdf content={item.bodyMarkdown} />
              ) : (
                <>
                  {item.description ? (
                    <Text style={styles.fieldText}>{item.description}</Text>
                  ) : null}
                  {item.whyItMatters ? (
                    <>
                      <Text style={styles.fieldLabel}>Why it matters</Text>
                      <Text style={styles.fieldText}>{item.whyItMatters}</Text>
                    </>
                  ) : null}
                  {item.outOfScope ? (
                    <>
                      <Text style={styles.fieldLabel}>Out of scope</Text>
                      <Text style={styles.fieldText}>{item.outOfScope}</Text>
                    </>
                  ) : null}
                  {item.definitionOfDone ? (
                    <>
                      <Text style={styles.fieldLabel}>Definition of done</Text>
                      <Text style={styles.fieldText}>
                        {item.definitionOfDone}
                      </Text>
                    </>
                  ) : null}
                </>
              )}
              {item.phases.length > 0 && (
                <>
                  <Text style={styles.fieldLabel}>Phases</Text>
                  {item.phases.map((phase, j) => (
                    <View key={j} style={styles.phaseRow}>
                      <Text style={styles.phaseTitle}>
                        <Text style={{ fontFamily: "Helvetica-Bold" }}>
                          {phase.title}
                        </Text>
                        {phase.description ? ` ${phase.description}` : ""}
                      </Text>
                      <Text style={styles.phasePrice}>
                        {fmt(phase.fixedPrice)}
                      </Text>
                    </View>
                  ))}
                  {item.isCapped && (
                    <Text style={styles.cappedNote}>
                      Capped — phase totals cannot exceed {fmt(item.fixedPrice)}.
                    </Text>
                  )}
                </>
              )}
            </View>
          </View>
        ))}

        {/* Total + selectable-subset note */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total (all items)</Text>
            <Text style={styles.totalValue}>{fmt(total)}</Text>
          </View>
        </View>
        <Text style={styles.selectableNote}>
          You may authorize any combination of the line items above — tick the
          box beside each item you accept. The accepted total is the sum of the
          selected items.
        </Text>

        {/* Terms */}
        {(paymentTermsLabel || deposit || warrantyDays != null || termsNotes) && (
          <View>
            <Text style={styles.sectionTitle}>Terms</Text>
            {paymentTermsLabel ? (
              <View style={styles.termRow}>
                <Text style={styles.termKey}>Payment terms</Text>
                <Text style={styles.termValue}>{paymentTermsLabel}</Text>
              </View>
            ) : null}
            {deposit ? (
              <View style={styles.termRow}>
                <Text style={styles.termKey}>Deposit</Text>
                <Text style={styles.termValue}>{deposit}</Text>
              </View>
            ) : null}
            {warrantyDays != null ? (
              <View style={styles.termRow}>
                <Text style={styles.termKey}>Warranty</Text>
                <Text style={styles.termValue}>{warrantyDays} days</Text>
              </View>
            ) : null}
            {termsNotes ? (
              <Text style={styles.termsNotesText}>{termsNotes}</Text>
            ) : null}
          </View>
        )}

        {/* Acceptance — both parties on the record. wrap={false} keeps the
            signature block on one page so a paper signer never gets a
            split signature line. */}
        <View wrap={false}>
          <Text style={styles.sectionTitle}>Acceptance</Text>
          <Text style={styles.acceptanceNote}>
            By signing below, I authorize the ticked line items at the prices
            shown, under the terms above.
          </Text>
          <View style={styles.signatureRow}>
            {/* A multi-signer proposal (2+ roster names) prints a signature
                column per signer, titled with their name; otherwise a single
                generic "Client" column. Provider always closes the row. */}
            {(props.signerNames && props.signerNames.length >= 2
              ? props.signerNames
              : ["Client"]
            ).map((title, i) => (
              <View key={`sig-client-${i}`} style={styles.signatureCol}>
                <Text style={styles.signatureColTitle}>{title}</Text>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureCaption}>Signature</Text>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureCaption}>Name / Title</Text>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureCaption}>Date</Text>
              </View>
            ))}
            <View style={styles.signatureCol}>
              <Text style={styles.signatureColTitle}>Provider</Text>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureCaption}>Signature</Text>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureCaption}>Name / Title</Text>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureCaption}>Date</Text>
            </View>
          </View>
        </View>

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
