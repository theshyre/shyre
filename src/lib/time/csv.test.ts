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

describe("toCsv", () => {
  it("includes the header row", () => {
    const csv = toCsv([]);
    expect(csv).toContain("Date,Start,End,Duration (min)");
    expect(csv).toContain("GitHub Issue");
  });

  it("renders a row in the expected column order", () => {
    const row: CsvEntryRow = {
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
    };
    const csv = toCsv([row]);
    expect(csv.split("\r\n")[1]).toBe(
      "2026-04-13,09:00,10:30,90,Alpha,Acme,Feature,wrote tests,true,42",
    );
  });

  it("properly escapes commas in descriptions", () => {
    const row: CsvEntryRow = {
      date: "2026-04-13",
      start: "09:00",
      end: "10:30",
      durationMin: 90,
      project: "Alpha",
      client: "",
      category: "",
      description: "fixed bug, added test",
      billable: true,
      githubIssue: null,
    };
    const csv = toCsv([row]);
    expect(csv).toContain('"fixed bug, added test"');
  });

  it("ends with a newline", () => {
    const csv = toCsv([]);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
