import { describe, it, expect } from "vitest";
import {
  invoicedEntriesRefusalMessage,
  invoicesOnImportedCustomersRefusalMessage,
} from "./undo-refusal";

describe("invoicedEntriesRefusalMessage", () => {
  it("singular entry, singular invoice", () => {
    expect(invoicedEntriesRefusalMessage(1, 1)).toBe(
      "1 imported time entry is attached to 1 invoice. Void or delete that invoice first, then try undo again.",
    );
  });
  it("plural entries, singular invoice", () => {
    expect(invoicedEntriesRefusalMessage(5, 1)).toBe(
      "5 imported time entries are attached to 1 invoice. Void or delete that invoice first, then try undo again.",
    );
  });
  it("singular entry, plural invoices (unusual but possible)", () => {
    expect(invoicedEntriesRefusalMessage(1, 2)).toBe(
      "1 imported time entry is attached to 2 invoices. Void or delete those invoices first, then try undo again.",
    );
  });
  it("plural entries, plural invoices", () => {
    expect(invoicedEntriesRefusalMessage(12, 3)).toBe(
      "12 imported time entries are attached to 3 invoices. Void or delete those invoices first, then try undo again.",
    );
  });
});

describe("invoicesOnImportedCustomersRefusalMessage", () => {
  it("singular invoice", () => {
    expect(invoicesOnImportedCustomersRefusalMessage(1)).toBe(
      "1 invoice references an imported customer. Delete or void those invoices before undoing this import.",
    );
  });
  it("plural invoices", () => {
    expect(invoicesOnImportedCustomersRefusalMessage(4)).toBe(
      "4 invoices reference an imported customer. Delete or void those invoices before undoing this import.",
    );
  });
});
