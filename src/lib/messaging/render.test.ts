import { describe, it, expect } from "vitest";
import {
  renderTemplate,
  sanitizeHeaderValue,
  validateRecipient,
} from "./render";

describe("renderTemplate", () => {
  it("substitutes known variables", () => {
    const out = renderTemplate(
      "Hi %customer_name%, your invoice %invoice_id% for %invoice_amount% is due %invoice_due_date%.",
      {
        customerName: "Acme",
        invoiceId: "INV-001",
        invoiceAmount: "$1,200.00",
        invoiceDueDate: "Jun 1, 2026",
      },
    );
    expect(out).toBe(
      "Hi Acme, your invoice INV-001 for $1,200.00 is due Jun 1, 2026.",
    );
  });

  it("leaves unknown placeholders untouched (so typos are visible)", () => {
    const out = renderTemplate("Hello %not_a_real_var%", {
      customerName: "Acme",
    });
    expect(out).toBe("Hello %not_a_real_var%");
  });

  it("treats placeholder lookup as case-insensitive", () => {
    expect(
      renderTemplate("ID: %INVOICE_ID%", { invoiceId: "INV-1" }),
    ).toBe("ID: INV-1");
  });

  it("renders empty string when the template is empty", () => {
    expect(renderTemplate("", {})).toBe("");
  });

  it("`days_past_due` numeric variable renders as digits", () => {
    expect(
      renderTemplate("%days_past_due% days late.", { daysPastDue: 7 }),
    ).toBe("7 days late.");
  });
});

describe("sanitizeHeaderValue", () => {
  it("strips CR + LF (header-injection guard)", () => {
    const malicious =
      "Invoice INV-001\r\nBcc: attacker@evil.com\r\nFrom: ceo@victim.com";
    const safe = sanitizeHeaderValue(malicious);
    // No CR/LF means whatever the attacker tried to smuggle becomes
    // part of the subject text, not a new MIME header. The literal
    // "Bcc:" string remains in the visible subject — that's fine,
    // the injection is the LF, not the substring.
    expect(safe).not.toMatch(/[\r\n]/);
  });

  it("collapses whitespace runs", () => {
    expect(sanitizeHeaderValue("a   b\t\tc")).toBe("a b c");
  });

  it("trims leading + trailing whitespace", () => {
    expect(sanitizeHeaderValue("   subject   ")).toBe("subject");
  });

  it("preserves benign content unchanged", () => {
    expect(sanitizeHeaderValue("Invoice INV-001 from Malcom IO")).toBe(
      "Invoice INV-001 from Malcom IO",
    );
  });

  it("caps at 998 octets per RFC 5322", () => {
    const huge = "a".repeat(2000);
    expect(sanitizeHeaderValue(huge).length).toBe(998);
  });

  it("returns empty string for null/empty", () => {
    expect(sanitizeHeaderValue("")).toBe("");
  });
});

describe("validateRecipient", () => {
  it("accepts a normal email", () => {
    expect(validateRecipient("ap@acme.com")).toBeNull();
    expect(validateRecipient("someone+tag@example.co.uk")).toBeNull();
  });

  it("rejects malformed addresses", () => {
    expect(validateRecipient("")).toBe("invalid");
    expect(validateRecipient("not-an-email")).toBe("invalid");
    expect(validateRecipient("missing@")).toBe("invalid");
    expect(validateRecipient("@nodomain.com")).toBe("invalid");
  });

  it("rejects role addresses (suppression-list bait)", () => {
    expect(validateRecipient("noreply@acme.com")).toBe("role");
    expect(validateRecipient("no-reply@acme.com")).toBe("role");
    expect(validateRecipient("postmaster@acme.com")).toBe("role");
    expect(validateRecipient("abuse@acme.com")).toBe("role");
    expect(validateRecipient("mailer-daemon@acme.com")).toBe("role");
  });

  it("rejects oversized addresses", () => {
    const long = "a".repeat(250) + "@example.com";
    expect(validateRecipient(long)).toBe("invalid");
  });
});
