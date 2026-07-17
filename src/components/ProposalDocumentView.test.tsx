import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import {
  ProposalDocumentView,
  type ProposalDocumentViewProps,
} from "./ProposalDocumentView";

const base: ProposalDocumentViewProps = {
  business: {
    name: "Malcom IO",
    logoUrl: null,
    brandColor: "#157347",
    wordmarkPrimary: "malcom",
    wordmarkSecondary: ".io",
  },
  customer: { name: "EyeReg", logoUrl: null, accentColor: "#2563EB" },
  proposal: {
    proposalNumber: "PROP-2026-007",
    title: "Platform modernization",
    validUntil: "2026-08-15",
    paymentTermsLabel: "Net 30",
    depositType: "percent",
    depositValue: 25,
    warrantyDays: 30,
    termsNotes: "Phasing per item.",
    currency: "USD",
  },
  items: [
    {
      id: "li-1",
      title: "Dependency upgrades",
      description: "Bring deps current.",
      whyItMatters: "Reduces CVE exposure.",
      outOfScope: "Major framework jumps.",
      definitionOfDone: "CI green.",
      fixedPrice: 950,
      isCapped: false,
      phases: [],
    },
    {
      id: "li-2",
      title: "Modernize components",
      description: null,
      whyItMatters: null,
      outOfScope: null,
      definitionOfDone: null,
      fixedPrice: 4000,
      isCapped: true,
      phases: [{ title: "Visual framework", fixedPrice: 4000 }],
    },
  ],
  total: 4950,
};

describe("ProposalDocumentView", () => {
  it("renders the branded document body the client will see", () => {
    renderWithIntl(<ProposalDocumentView {...base} />);
    expect(screen.getByText("Platform modernization")).toBeInTheDocument();
    expect(screen.getByText("PROP-2026-007", { exact: false })).toBeInTheDocument();
    // Line items + detail + phases + total.
    expect(screen.getByText("Dependency upgrades")).toBeInTheDocument();
    expect(screen.getByText(/Reduces CVE exposure/)).toBeInTheDocument();
    expect(screen.getByText("Visual framework")).toBeInTheDocument();
    expect(screen.getByText("$4,950.00")).toBeInTheDocument();
    // Terms.
    expect(screen.getByText(/Net 30/)).toBeInTheDocument();
    expect(screen.getByText(/Phasing per item/)).toBeInTheDocument();
  });

  it("has NO interactive controls — read-only (no checkboxes, no buttons)", () => {
    renderWithIntl(<ProposalDocumentView {...base} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the two-tone wordmark when no logo is set", () => {
    renderWithIntl(<ProposalDocumentView {...base} />);
    expect(screen.getByText("malcom")).toBeInTheDocument();
    expect(screen.getByText(".io")).toBeInTheDocument();
  });

  it("renders the business logo (and hides the wordmark) when a logo is set", () => {
    renderWithIntl(
      <ProposalDocumentView
        {...base}
        business={{ ...base.business, logoUrl: "https://x/branding/t/logo.png" }}
      />,
    );
    expect(screen.queryByText("malcom")).not.toBeInTheDocument();
    // The customer co-brand line names the customer.
    expect(screen.getByText("EyeReg")).toBeInTheDocument();
  });
});
