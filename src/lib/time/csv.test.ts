import { describe, it, expect } from "vitest";
import { escapeCsvField, toCsv, type CsvEntryRow } from "./csv";

describe("escapeCsvField", () => {
  it("passes through simple text", () => {
    expect(escapeCsvField("hello")).toBe("hello");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField("")).toBe("");
  });

  it("quotes fields with commas", () => {
    expect(escapeCsvField("a, b")).toBe('"a, b"');
  });

  it("quotes fields with newlines", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("doubles embedded quotes", () => {
    expect(escapeCsvField('she said "hi"')).toBe('"she said ""hi"""');
  });

  it("stringifies numbers and booleans", () => {
    expect(escapeCsvField(42)).toBe("42");
    expect(escapeCsvField(true)).toBe("true");
    expect(escapeCsvField(false)).toBe("false");
  });
});

function row(overrides: Partial<CsvEntryRow> = {}): CsvEntryRow {
  return {
    date: "2026-04-13",
    start: "09:00",
    end: "10:30",
    durationMin: 90,
    project: "Alpha",
    client: "Acme",
    category: "Feature",
    description: "wrote tests",
    billable: true,
    githubIssue: 42,
    ticketKey: "",
    ticketProvider: "",
    startIso: "2026-04-13T09:00:00.000Z",
    endIso: "2026-04-13T10:30:00.000Z",
    entryId: "entry-1",
    userId: "user-1",
    userName: "Marcus",
    teamId: "team-1",
    projectId: "proj-1",
    customerId: "cust-1",
    invoiceId: "",
    invoiced: false,
    ...overrides,
  };
}

describe("toCsv", () => {
  it("includes the documented header row (UTC + reconciliation columns)", () => {
    const csv = toCsv([]);
    expect(csv).toContain("Date (UTC),Start (UTC),End (UTC),Duration (min)");
    expect(csv).toContain("Entry ID");
    expect(csv).toContain("Invoice ID");
    expect(csv).toContain("Invoiced");
  });

  it("renders the leading display columns first, followed by the reconciliation columns", () => {
    const csv = toCsv([row()]);
    const dataLine = csv.split("\r\n")[1] ?? "";
    // Display columns + legacy githubIssue + new ticketKey/Provider
    // columns + reconciliation tail.
    expect(dataLine.startsWith(
      "2026-04-13,09:00,10:30,90,Alpha,Acme,Feature,wrote tests,true,42,,,",
    )).toBe(true);
    expect(dataLine).toContain("entry-1");
    expect(dataLine).toContain("team-1");
    expect(dataLine).toContain("proj-1");
    // invoiced=false comes through as a literal "false"; the
    // booleans-stringify rule from escapeCsvField applies here.
    expect(dataLine).toMatch(/false$/);
  });

  it("emits the new Ticket Key + Ticket Provider columns when populated", () => {
    const csv = toCsv([
      row({ ticketKey: "AE-640", ticketProvider: "jira", githubIssue: null }),
    ]);
    expect(csv).toContain("Ticket Key");
    expect(csv).toContain("Ticket Provider");
    expect(csv).toContain("AE-640");
    expect(csv).toContain("jira");
  });

  it("properly escapes commas in descriptions", () => {
    const csv = toCsv([
      row({ description: "fixed bug, added test", githubIssue: null }),
    ]);
    expect(csv).toContain('"fixed bug, added test"');
  });

  it("ends with a newline", () => {
    const csv = toCsv([]);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
