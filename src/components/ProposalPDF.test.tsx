import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { ProposalPDF, type ProposalPDFProps } from "./ProposalPDF";

// Smoke tests in the InvoicePDF.test style: renderToString over the
// react-pdf element tree, then string-search. Locks in content presence,
// price formatting, date stability, and the paper signature block — not
// pixel layout.

const baseProps: ProposalPDFProps = {
  proposalNumber: "PROP-2026-001",
  title: "Platform modernization",
  issuedDate: "2026-07-16",
  validUntil: "2026-08-15",
  paymentTermsLabel: "Net 30",
  depositType: "percent",
  depositValue: 25,
  warrantyDays: 30,
  termsNotes: "Phasing per item as listed.",
  total: 7450,
  currency: "USD",
  business: {
    name: "Malcom IO",
    email: "info@malcom.io",
    address: null,
    phone: null,
    wordmarkPrimary: "malcom",
    wordmarkSecondary: ".io",
    brandColor: "#3b82f6",
  },
  client: {
    name: "EyeReg Consulting, Inc.",
    email: "ap@eyereg.example",
    address: null,
  },
  signerName: "Jordan Chen",
  items: [
    {
      title: "Basic dependency upgrades",
      description: "Bring all in-range dependencies current.",
      whyItMatters: "Reduces exposure to known CVEs.",
      outOfScope: "Major-version framework jumps.",
      definitionOfDone: "CI green on the upgraded lockfile.",
      fixedPrice: 950,
      isCapped: false,
      phases: [],
    },
    {
      title: "Modernize underlying components",
      description: null,
      whyItMatters: null,
      outOfScope: null,
      definitionOfDone: null,
      fixedPrice: 4000,
      isCapped: true,
      phases: [
        { title: "Update the visual framework", fixedPrice: 2200 },
        { title: "Retire older libraries", fixedPrice: 1200 },
        { title: "Refresh code-quality checks", fixedPrice: 600 },
      ],
    },
  ],
};

/** renderToString separates adjacent text nodes with `<!-- -->` markers —
 *  strip them so interpolated strings ("Attn: {name}") assert naturally. */
function textOf(el: React.ReactElement): string {
  return renderToString(el).replace(/<!-- -->/g, "");
}

describe("ProposalPDF", () => {
  const html = textOf(<ProposalPDF {...baseProps} />);

  it("renders header, meta, and both parties", () => {
    expect(html).toContain("PROP-2026-001");
    expect(html).toContain("Platform modernization");
    expect(html).toContain("Malcom IO");
    expect(html).toContain("EyeReg Consulting, Inc.");
    expect(html).toContain("Attn: Jordan Chen");
  });

  it("renders dates without timezone drift", () => {
    expect(html).toContain("07/16/2026");
    expect(html).toContain("08/15/2026");
  });

  it("renders items with formatted prices and phase breakdown", () => {
    expect(html).toContain("Basic dependency upgrades");
    expect(html).toContain("$950.00");
    expect(html).toContain("$4,000.00");
    expect(html).toContain("Update the visual framework");
    expect(html).toContain("$2,200.00");
    // capped note carries the parent price
    expect(html).toContain("phase totals cannot exceed $4,000.00");
  });

  it("renders the structured item fields", () => {
    expect(html).toContain("Why it matters");
    expect(html).toContain("Reduces exposure to known CVEs.");
    expect(html).toContain("Out of scope");
    expect(html).toContain("Definition of done");
  });

  it("renders the total and the selectable-subset note", () => {
    expect(html).toContain("$7,450.00");
    expect(html).toContain("any combination of the line items");
  });

  it("renders terms including the percent deposit", () => {
    expect(html).toContain("Net 30");
    expect(html).toContain("25% of accepted total");
    expect(html).toContain("30 days");
    expect(html).toContain("Phasing per item as listed.");
  });

  it("renders the two-party signature block", () => {
    expect(html).toContain("Acceptance");
    expect(html).toContain("Client");
    expect(html).toContain("Provider");
    expect(html).toContain("Signature");
    expect(html).toContain("Name / Title");
  });

  it("renders a flat-amount deposit and survives missing optionals", () => {
    const flat = textOf(
      <ProposalPDF
        {...baseProps}
        depositType="amount"
        depositValue={500}
        paymentTermsLabel={null}
        warrantyDays={null}
        termsNotes={null}
        validUntil={null}
        signerName={null}
      />,
    );
    expect(flat).toContain("$500.00 up front");
    expect(flat).not.toContain("Attn:");
  });
});
