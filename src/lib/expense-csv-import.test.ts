import { describe, it, expect } from "vitest";
import {
  buildExpenseImportSourceId,
  findColumnIndex,
  parseExpenseAmount,
  parseExpenseCsv,
  parseExpenseDate,
  splitItemIntoVendorAndDescription,
  tokenizeCsv,
} from "./expense-csv-import";

describe("tokenizeCsv", () => {
  it("parses a simple comma-separated row", () => {
    expect(tokenizeCsv("a,b,c\n")).toEqual([["a", "b", "c"]]);
  });

  it("handles quoted fields with embedded commas", () => {
    expect(tokenizeCsv('a,"b,c",d\n')).toEqual([["a", "b,c", "d"]]);
  });

  it("handles escaped double-quotes inside a quoted field", () => {
    expect(tokenizeCsv('a,"He said ""hi""",b\n')).toEqual([
      ["a", 'He said "hi"', "b"],
    ]);
  });

  it("handles multi-line quoted fields (Google Sheets multi-line cells)", () => {
    const csv =
      'a,"first line\nsecond line\nthird",c\n';
    expect(tokenizeCsv(csv)).toEqual([
      ["a", "first line\nsecond line\nthird", "c"],
    ]);
  });

  it("normalizes CRLF line endings to LF", () => {
    expect(tokenizeCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("flushes a trailing record with no final newline", () => {
    expect(tokenizeCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("returns empty for empty input", () => {
    expect(tokenizeCsv("")).toEqual([]);
  });
});

describe("parseExpenseDate", () => {
  it("parses M/D/YYYY", () => {
    expect(parseExpenseDate("9/28/2018")).toBe("2018-09-28");
  });

  it("parses MM/DD/YYYY", () => {
    expect(parseExpenseDate("12/14/2018")).toBe("2018-12-14");
  });

  it("passes through valid YYYY-MM-DD", () => {
    expect(parseExpenseDate("2024-03-15")).toBe("2024-03-15");
  });

  it("rejects invalid Feb 30 even when it parses", () => {
    expect(parseExpenseDate("2/30/2024")).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseExpenseDate("yesterday")).toBeNull();
    expect(parseExpenseDate("")).toBeNull();
    expect(parseExpenseDate("13/1/2024")).toBeNull();
  });
});

describe("parseExpenseAmount", () => {
  it("strips dollar sign and commas", () => {
    expect(parseExpenseAmount("$8,171.67")).toBe(8171.67);
  });

  it("handles whitespace", () => {
    expect(parseExpenseAmount("  $ 1,234.50 ")).toBe(1234.5);
  });

  it("handles bare numbers", () => {
    expect(parseExpenseAmount("100")).toBe(100);
  });

  it("rounds to two decimals", () => {
    expect(parseExpenseAmount("1.236")).toBeCloseTo(1.24, 2);
    expect(parseExpenseAmount("1.234")).toBeCloseTo(1.23, 2);
  });

  it("rejects negative", () => {
    expect(parseExpenseAmount("-50")).toBeNull();
  });

  it("rejects non-numeric", () => {
    expect(parseExpenseAmount("free")).toBeNull();
    expect(parseExpenseAmount("")).toBeNull();
  });
});

describe("splitItemIntoVendorAndDescription", () => {
  it("splits on the first ' - ' delimiter", () => {
    expect(splitItemIntoVendorAndDescription("Linode - server")).toEqual({
      vendor: "Linode",
      description: "server",
    });
  });

  it("preserves description-side details after the split", () => {
    expect(
      splitItemIntoVendorAndDescription(
        "G Suite - malcom.io: 1 user on the $5/month/user G Suite plan",
      ),
    ).toEqual({
      vendor: "G Suite",
      description: "malcom.io: 1 user on the $5/month/user G Suite plan",
    });
  });

  it("only splits on the first ' - ' (later ones stay in description)", () => {
    expect(
      splitItemIntoVendorAndDescription("Vendor - part-one - part-two"),
    ).toEqual({
      vendor: "Vendor",
      description: "part-one - part-two",
    });
  });

  it("doesn't split on adjacent dashes (no spaces around)", () => {
    expect(splitItemIntoVendorAndDescription("AT&T-billing")).toEqual({
      vendor: null,
      description: "AT&T-billing",
    });
  });

  it("returns whole string in description when no delimiter", () => {
    expect(
      splitItemIntoVendorAndDescription("Networking equipment from Platt"),
    ).toEqual({
      vendor: null,
      description: "Networking equipment from Platt",
    });
  });

  it("returns nulls for empty input", () => {
    expect(splitItemIntoVendorAndDescription("")).toEqual({
      vendor: null,
      description: null,
    });
  });
});

describe("buildExpenseImportSourceId", () => {
  const base = {
    incurred_on: "2019-03-19",
    amount: 5000,
    vendor: null,
    description: "Initial deposit for founding Malcom IO LLC",
    notes: null,
  };

  it("is deterministic for identical inputs", () => {
    expect(buildExpenseImportSourceId(base)).toBe(
      buildExpenseImportSourceId(base),
    );
  });

  it("changes when amount changes", () => {
    expect(buildExpenseImportSourceId(base)).not.toBe(
      buildExpenseImportSourceId({ ...base, amount: 5001 }),
    );
  });

  it("changes when notes change — distinguishes recurring monthly bills", () => {
    // Same Linode $10 bill, two different invoice numbers in notes.
    const a = buildExpenseImportSourceId({
      incurred_on: "2019-01-01",
      amount: 10,
      vendor: "Linode",
      description: "server",
      notes: "Invoice #12045531",
    });
    const b = buildExpenseImportSourceId({
      incurred_on: "2019-01-01",
      amount: 10,
      vendor: "Linode",
      description: "server",
      notes: "Invoice #12204828",
    });
    expect(a).not.toBe(b);
  });

  it("produces a 32-hex-character string", () => {
    const id = buildExpenseImportSourceId(base);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("findColumnIndex", () => {
  it("finds canonical headers case-insensitively", () => {
    expect(findColumnIndex(["", "Date", "Amount", "Item"], "date")).toBe(1);
    expect(findColumnIndex(["", "Date", "Amount", "Item"], "amount")).toBe(2);
    expect(findColumnIndex(["", "Date", "Amount", "Item"], "item")).toBe(3);
  });

  it("accepts aliases", () => {
    expect(findColumnIndex(["incurred_on", "total"], "date")).toBe(0);
    expect(findColumnIndex(["incurred_on", "total"], "amount")).toBe(1);
  });

  it("returns -1 when missing", () => {
    expect(findColumnIndex(["a", "b"], "date")).toBe(-1);
  });
});

describe("parseExpenseCsv — end to end", () => {
  it("parses the canonical Google Sheets shape from the source spreadsheet", () => {
    const csv = [
      ",Date,Amount,Item,Comments",
      ',9/28/2018,$60.00,Domain - malcom.io: 1 year renewal,',
      ',1/1/2019,$10.00,Linode - server,Invoice #12045531',
      ',3/19/2019,"$5,000.00",Initial deposit for founding Malcom IO LLC,',
    ].join("\n");

    const { rows, skipped } = parseExpenseCsv(csv);
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(3);

    expect(rows[0]).toMatchObject({
      incurred_on: "2018-09-28",
      amount: 60,
      vendor: "Domain",
      description: "malcom.io: 1 year renewal",
      notes: null,
    });
    expect(rows[1]).toMatchObject({
      incurred_on: "2019-01-01",
      amount: 10,
      vendor: "Linode",
      description: "server",
      notes: "Invoice #12045531",
    });
    expect(rows[2]).toMatchObject({
      incurred_on: "2019-03-19",
      amount: 5000,
      vendor: null,
      description: "Initial deposit for founding Malcom IO LLC",
      notes: null,
    });
  });

  it("skips rows with bad dates and keeps good rows", () => {
    const csv = [
      "Date,Amount,Item,Comments",
      "9/28/2018,$60.00,OK row,",
      "yesterday,$10.00,Bad date,",
      "10/2/2019,$125.95,Networking equipment from Platt,X260361",
    ].join("\n");

    const { rows, skipped } = parseExpenseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toContain("date");
  });

  it("skips rows with negative amounts", () => {
    const csv = [
      "Date,Amount,Item,Comments",
      "9/28/2018,-$60.00,Bogus,",
    ].join("\n");

    const { rows, skipped } = parseExpenseCsv(csv);
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toContain("amount");
  });

  it("treats blank rows as no-ops, not skips", () => {
    const csv = [
      "Date,Amount,Item,Comments",
      "9/28/2018,$60.00,Real row,",
      ",,,",
      "",
    ].join("\n");

    const { rows, skipped } = parseExpenseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  it("returns a clear single error when Date / Amount headers are missing", () => {
    const csv = ["Foo,Bar,Baz", "1,2,3"].join("\n");
    const { rows, skipped } = parseExpenseCsv(csv);
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toContain("Date");
    expect(skipped[0]?.reason).toContain("Amount");
  });

  it("gives a path-paste-specific hint when input looks like a dragged-onto-textarea filepath", () => {
    // What happens when a user drags a CSV onto the textarea and
    // the browser pastes the file's path instead of its contents.
    const csv = "/Users/marcus/Downloads/Business Expenses - 2019.csv";
    const { rows, skipped } = parseExpenseCsv(csv);
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toMatch(/file path was pasted/i);
    expect(skipped[0]?.reason).toContain("Choose File");
  });

  it("handles multi-line Comments cells (the McEwen Gisvold pattern)", () => {
    const csv = [
      "Date,Amount,Item,Comments",
      `4/11/2019,$287.00,"McEwen Gisvold LLP - filing fees","Client / Matter Number: 16028 - 00001\nBill Number: 108405"`,
    ].join("\n");

    const { rows, skipped } = parseExpenseCsv(csv);
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.notes).toBe(
      "Client / Matter Number: 16028 - 00001\nBill Number: 108405",
    );
  });
});
