import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { InvoicePDF } from "./InvoicePDF";

// @react-pdf/renderer's <Document>/<Page>/<Text>/<View> render to
// custom DOM tags; renderToString gives us plain HTML-ish output
// we can string-search. This is a smoke test, not a layout test —
// the goal is to lock in:
//   - JSON-encoded addresses are deserialized + rendered as lines,
//     not dumped as `{"street":...}`
//   - missing addresses don't crash
//   - dates render in a stable format

const baseProps = {
  invoiceNumber: "INV-001",
  issuedDate: "2026-01-19",
  dueDate: "2026-02-18",
  notes: null,
  subtotal: 1000,
  taxRate: 0,
  taxAmount: 0,
  total: 1000,
  currency: "USD",
  lineItems: [
    { description: "Consulting", quantity: 10, unitPrice: 100, amount: 1000 },
  ],
};

describe("InvoicePDF", () => {
  it("renders a JSON-stored business address as multi-line text, not raw JSON", () => {
    const html = renderToString(
      <InvoicePDF
        {...baseProps}
        business={{
          name: "Malcom IO",
          email: "info@malcom.io",
          phone: null,
          address: JSON.stringify({
            street: "1822 5th Ave",
            street2: "",
            city: "West Linn",
            state: "OR",
            postalCode: "97068",
            country: "US",
          }),
        }}
        client={{
          name: "EyeReg Consulting, Inc.",
          email: null,
          address: null,
        }}
      />,
    );
    expect(html).toContain("1822 5th Ave");
    expect(html).toContain("West Linn, OR, 97068");
    // The raw JSON braces / postalCode key must not leak through.
    expect(html).not.toContain("postalCode");
    expect(html).not.toContain('"street"');
  });

  it("renders a JSON-stored client address as multi-line text", () => {
    const html = renderToString(
      <InvoicePDF
        {...baseProps}
        business={{
          name: "Acme",
          email: null,
          phone: null,
          address: null,
        }}
        client={{
          name: "EyeReg Consulting, Inc.",
          email: null,
          address: JSON.stringify({
            street: "6119 Canter Ln",
            street2: "",
            city: "West Linn",
            state: "OR",
            postalCode: "97068",
            country: "US",
          }),
        }}
      />,
    );
    expect(html).toContain("6119 Canter Ln");
    expect(html).not.toContain("postalCode");
  });

  it("does not crash on null addresses / missing optional fields", () => {
    expect(() =>
      renderToString(
        <InvoicePDF
          {...baseProps}
          business={{ name: null, email: null, phone: null, address: null }}
          client={{ name: "Client", email: null, address: null }}
        />,
      ),
    ).not.toThrow();
  });

  it("falls back gracefully on malformed address JSON (legacy plain text)", () => {
    const html = renderToString(
      <InvoicePDF
        {...baseProps}
        business={{
          name: "Acme",
          email: null,
          phone: null,
          address: "123 Old Plain Text Address",
        }}
        client={{ name: "Client", email: null, address: null }}
      />,
    );
    expect(html).toContain("123 Old Plain Text Address");
  });

  it("renders dates in MM/DD/YYYY format", () => {
    const html = renderToString(
      <InvoicePDF
        {...baseProps}
        business={{ name: "Acme", email: null, phone: null, address: null }}
        client={{ name: "Client", email: null, address: null }}
      />,
    );
    expect(html).toContain("01/19/2026");
    expect(html).toContain("02/18/2026");
  });

  it("renders an em-dash for null dates", () => {
    const html = renderToString(
      <InvoicePDF
        {...baseProps}
        issuedDate={null}
        dueDate={null}
        business={{ name: "Acme", email: null, phone: null, address: null }}
        client={{ name: "Client", email: null, address: null }}
      />,
    );
    expect(html).toContain("—");
  });

  it("renders a two-tone wordmark when wordmarkPrimary + secondary are set", () => {
    const html = renderToString(
      <InvoicePDF
        {...baseProps}
        business={{
          name: "Malcom IO",
          email: null,
          phone: null,
          address: null,
          wordmarkPrimary: "malcom",
          wordmarkSecondary: ".io",
          brandColor: "#7BAE5F",
        }}
        client={{ name: "Client", email: null, address: null }}
      />,
    );
    // Both halves render.
    expect(html).toContain("malcom");
    expect(html).toContain(".io");
    // Brand color is applied (the primary half is wrapped in a Text
    // with color: <hex>).
    expect(html.toLowerCase()).toContain("color:#7bae5f");
  });

  it("falls back to business.name when no wordmark is configured", () => {
    const html = renderToString(
      <InvoicePDF
        {...baseProps}
        business={{
          name: "Acme Co",
          email: null,
          phone: null,
          address: null,
        }}
        client={{ name: "Client", email: null, address: null }}
      />,
    );
    expect(html).toContain("Acme Co");
  });

  it("rejects malformed brand colors (defends against worker crash)", () => {
    // A non-hex value should be silently ignored — the wordmark
    // still renders, just in default ink.
    expect(() =>
      renderToString(
        <InvoicePDF
          {...baseProps}
          business={{
            name: "Acme",
            email: null,
            phone: null,
            address: null,
            wordmarkPrimary: "Acme",
            brandColor: "javascript:alert(1)",
          }}
          client={{ name: "Client", email: null, address: null }}
        />,
      ),
    ).not.toThrow();
  });

  it("appends '(Net 30)' to the due date when issue→due gap is 30 days", () => {
    const html = renderToString(
      <InvoicePDF
        {...baseProps}
        issuedDate="2026-04-19"
        dueDate="2026-05-19"
        business={{ name: "Acme", email: null, phone: null, address: null }}
        client={{ name: "Client", email: null, address: null }}
      />,
    );
    expect(html).toContain("Net 30");
  });

  it("does NOT append a Net label for non-canonical date gaps", () => {
    const html = renderToString(
      <InvoicePDF
        {...baseProps}
        issuedDate="2026-01-19"
        dueDate="2026-01-29"
        business={{ name: "Acme", email: null, phone: null, address: null }}
        client={{ name: "Client", email: null, address: null }}
      />,
    );
    // 10 days isn't a canonical net term — no badge.
    expect(html).not.toContain("Net 10");
  });

  it("renders Subtotal / Payments / Amount Due rollup when payments > 0", () => {
    const html = renderToString(
      <InvoicePDF
        {...baseProps}
        paymentsTotal={1000}
        business={{ name: "Acme", email: null, phone: null, address: null }}
        client={{ name: "Client", email: null, address: null }}
      />,
    );
    expect(html).toContain("Payments");
    expect(html).toContain("Amount Due");
    // Negative payment line — React inserts <!-- --> between the
    // literal "-" and the formatted amount, so match each part.
    expect(html).toContain("-");
    expect(html).toContain("$1,000.00");
    // Total label disappears in this mode (Amount Due replaces it).
    expect(html).not.toMatch(/>Total</);
  });

  it("uses 'Amount Due' as the bottom-row label even without payments", () => {
    // Earlier code flipped to "Amount Due" only when payments were
    // present, leaving unpaid invoices labeled "Total" — which
    // confused AP teams that key on "Amount Due" as the field
    // they cut a check against. Now unconditional.
    const html = renderToString(
      <InvoicePDF
        {...baseProps}
        paymentsTotal={0}
        business={{ name: "Acme", email: null, phone: null, address: null }}
        client={{ name: "Client", email: null, address: null }}
      />,
    );
    expect(html).toContain("Amount Due");
    // "Subtotal" is fine; only the standalone "Total" label is gone.
    expect(html).not.toMatch(/>Total</);
  });
});
