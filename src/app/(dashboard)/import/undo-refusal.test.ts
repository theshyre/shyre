import { describe, it, expect } from "vitest";
import {
  invoicedEntriesRefusalMessage,
  invoicesOnImportedCustomersRefusalMessage,
  manualEntriesOnImportedProjectsRefusalMessage,
  manualProjectsOnImportedCustomersRefusalMessage,
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

describe("manualEntriesOnImportedProjectsRefusalMessage", () => {
  it("1 entry on 1 project", () => {
    expect(manualEntriesOnImportedProjectsRefusalMessage(1, 1)).toBe(
      "1 manual time entry exists on a project this import created. Move it to another project first, or you'll lose it when the project is deleted.",
    );
  });
  it("plural entries on 1 project", () => {
    expect(manualEntriesOnImportedProjectsRefusalMessage(5, 1)).toBe(
      "5 manual time entries exist on a project this import created. Move them to another project first, or you'll lose them when the project is deleted.",
    );
  });
  it("plural entries across multiple projects", () => {
    expect(manualEntriesOnImportedProjectsRefusalMessage(8, 2)).toBe(
      "8 manual time entries exist on 2 projects this import created. Move them to another project first, or you'll lose them when the project is deleted.",
    );
  });
});

describe("manualProjectsOnImportedCustomersRefusalMessage", () => {
  it("1 project on 1 customer", () => {
    expect(manualProjectsOnImportedCustomersRefusalMessage(1, 1)).toBe(
      "1 manual project is parented to a customer this import created. Move it to another customer first, or you'll lose it along with everything logged against it.",
    );
  });
  it("plural projects across multiple customers", () => {
    expect(manualProjectsOnImportedCustomersRefusalMessage(3, 2)).toBe(
      "3 manual projects are parented to 2 customers this import created. Move them to another customer first, or you'll lose them along with everything logged against them.",
    );
  });
});
