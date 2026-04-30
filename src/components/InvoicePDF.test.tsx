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
});
