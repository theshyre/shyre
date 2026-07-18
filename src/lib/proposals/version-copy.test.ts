import { describe, it, expect } from "vitest";
import {
  VERSION_COPY_COLUMNS,
  pickVersionCopyColumns,
} from "./version-copy";

describe("VERSION_COPY_COLUMNS", () => {
  it("copies every content/terms column a version must carry forward", () => {
    // A column missing here silently drops from version copies — this list is
    // the regression net for "added a proposals column, forgot the copier".
    const expected = [
      "customer_id",
      "signer_contact_id",
      "signing_mode",
      "title",
      "valid_until",
      "payment_terms_days",
      "payment_terms_label",
      "deposit_type",
      "deposit_value",
      "warranty_days",
      "terms_notes",
      "overview_markdown",
      "sign_theme",
      "currency",
    ];
    for (const column of expected) {
      expect(VERSION_COPY_COLUMNS).toContain(column);
    }
    expect(VERSION_COPY_COLUMNS).toHaveLength(expected.length);
  });

  it("never copies lifecycle state, identity, or billing artifacts", () => {
    const forbidden = [
      "id",
      "team_id", // set explicitly by the action, not blind-copied
      "user_id", // the versioning admin becomes the author
      "proposal_number", // freshly generated
      "version_number", // bumped, not copied
      "supersedes_proposal_id", // points at the source, not the source's source
      "issued_date", // fresh (DB default = today)
      "status", // a new version starts as draft
      "accepted_total", // belongs to the signed record
      "deposit_invoice_id", // billing artifact of the OLD document
      "created_at",
      "updated_at",
      "sent_at",
    ];
    for (const column of forbidden) {
      expect(VERSION_COPY_COLUMNS).not.toContain(column);
    }
  });

  it("has no duplicate columns", () => {
    expect(new Set(VERSION_COPY_COLUMNS).size).toBe(
      VERSION_COPY_COLUMNS.length,
    );
  });
});

describe("pickVersionCopyColumns", () => {
  it("picks exactly the copy columns off a select(*) row, dropping the rest", () => {
    const source: Record<string, unknown> = {
      id: "prop-1",
      status: "sent",
      accepted_total: 4950,
      customer_id: "cust-1",
      signer_contact_id: "contact-1",
      signing_mode: "all",
      title: "Modernization",
      valid_until: "2026-08-31",
      payment_terms_days: 30,
      payment_terms_label: "Net 30",
      deposit_type: "percent",
      deposit_value: 25,
      warranty_days: 90,
      terms_notes: "notes",
      overview_markdown: "## Overview",
      sign_theme: "warm",
      currency: "USD",
    };
    const picked = pickVersionCopyColumns(source);
    expect(Object.keys(picked).sort()).toEqual(
      [...VERSION_COPY_COLUMNS].sort(),
    );
    expect(picked.title).toBe("Modernization");
    expect(picked.sign_theme).toBe("warm");
    expect(picked.deposit_type).toBe("percent");
    expect(picked.deposit_value).toBe(25);
    expect("status" in picked).toBe(false);
    expect("accepted_total" in picked).toBe(false);
  });

  it("carries null column values through unchanged (a null term stays null)", () => {
    const picked = pickVersionCopyColumns({
      customer_id: "cust-1",
      valid_until: null,
      deposit_value: null,
    });
    expect(picked.valid_until).toBeNull();
    expect(picked.deposit_value).toBeNull();
  });
});
