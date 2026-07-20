import { describe, it, expect } from "vitest";
import { toCsv, type CsvEntryRow } from "./csv";

// escapeCsvField's own unit tests (including the SAL-048
// formula-injection defense) live in `src/lib/csv/escape.test.ts` now
// that the primitive is generic. The tests below cover the
// Stint-specific `toCsv` column layout, which exercises
// escapeCsvField internally on every field.

function row(overrides: Partial<CsvEntryRow> = {}): CsvEntryRow {
  return {
    date: "2026-04-13",
    start: "09:00",
    end: "10:30",
    durationMin: 90,
    project: "Alpha",
    client: "Acme",
    category: "Feature",
    categorySet: "Software development",
    periodBudgetPeriod: "",
    periodBudgetHoursCap: "",
    periodBudgetDollarsCap: "",
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
    source: "user",
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
    // columns + reconciliation tail. categorySet sits right after
    // `category` so a reviewer reads "Feature, Software development"
    // as the full taxonomy chain. The three periodBudget* columns
    // sit between categorySet and description.
    expect(dataLine.startsWith(
      "2026-04-13,09:00,10:30,90,Alpha,Acme,Feature,Software development,,,,wrote tests,true,42,,,",
    )).toBe(true);
    expect(dataLine).toContain("entry-1");
    expect(dataLine).toContain("team-1");
    expect(dataLine).toContain("proj-1");
    // invoiced=false comes through as a literal "false"; the
    // booleans-stringify rule from escapeCsvField applies here. The
    // SAL-051 Source column now trails it.
    expect(dataLine).toMatch(/false,user$/);
  });

  it("renders Period Budget columns when the project has a recurring cap", () => {
    const csv = toCsv([
      row({
        periodBudgetPeriod: "monthly",
        periodBudgetHoursCap: "30",
        periodBudgetDollarsCap: "6000",
        githubIssue: null,
      }),
    ]);
    expect(csv).toContain("Period Budget Type");
    expect(csv).toContain("Period Budget Hours Cap");
    expect(csv).toContain("Period Budget Dollars Cap");
    expect(csv).toContain("monthly");
    expect(csv).toContain("30");
    expect(csv).toContain("6000");
  });

  it("renders the Category Set column header (so a reviewer sees the full taxonomy chain even after a project's set switches)", () => {
    const csv = toCsv([]);
    expect(csv).toContain("Category Set");
  });

  it("emits an empty categorySet when the entry has no category", () => {
    const csv = toCsv([
      row({ category: "", categorySet: "", githubIssue: null }),
    ]);
    const dataLine = csv.split("\r\n")[1] ?? "";
    // Adjacent commas — category, categorySet, and the three
    // periodBudget* slots are all blank between `Acme` and
    // `wrote tests`.
    expect(dataLine).toContain("Acme,,,,,,wrote tests");
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

describe("toCsv — Source column (SAL-051)", () => {
  it("appends 'Source' as the last header so positional templates keep working", () => {
    const headerLine = toCsv([]).split("\r\n")[0] ?? "";
    expect(headerLine.endsWith(",Source")).toBe(true);
  });

  it("emits the started-by kind, with the agent label when present", () => {
    const csv = toCsv([
      row({ source: "agent (Claude Code)" }),
      row({ source: "import" }),
    ]);
    expect(csv).toContain("agent (Claude Code)");
    expect(csv).toContain("import");
  });

  it("neutralizes a formula-injection attempt smuggled through an agent label", () => {
    const csv = toCsv([row({ source: "=HYPERLINK(\"http://evil\")" })]);
    const dataLine = csv.split("\r\n")[1] ?? "";
    // escapeCsvField prefixes the apostrophe and quotes the field.
    expect(dataLine).toContain("'=HYPERLINK");
    expect(dataLine).not.toMatch(/,=HYPERLINK/);
  });
});
