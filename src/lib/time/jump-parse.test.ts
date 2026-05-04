import { describe, it, expect } from "vitest";
import { parseJumpInput, resolveChip } from "./jump-parse";

describe("parseJumpInput", () => {
  const today = "2026-05-04";

  describe("relative phrases", () => {
    it("parses 'today'", () => {
      const r = parseJumpInput("today", today);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.date).toBe("2026-05-04");
    });

    it("parses 'yesterday'", () => {
      const r = parseJumpInput("yesterday", today);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.date).toBe("2026-05-03");
    });

    it("is case-insensitive", () => {
      expect(parseJumpInput("TODAY", today).ok).toBe(true);
      expect(parseJumpInput("Yesterday", today).ok).toBe(true);
    });

    it("trims surrounding whitespace", () => {
      expect(parseJumpInput("  today  ", today).ok).toBe(true);
    });
  });

  describe("YYYY-MM-DD exact day", () => {
    it("parses a valid date", () => {
      const r = parseJumpInput("2024-04-15", today);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.date).toBe("2024-04-15");
    });

    it("rejects month=13", () => {
      const r = parseJumpInput("2024-13-01", today);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/month.*13.*invalid/i);
    });

    it("rejects day=32 in a 31-day month", () => {
      const r = parseJumpInput("2024-01-32", today);
      expect(r.ok).toBe(false);
    });

    it("rejects Feb 29 in a non-leap year", () => {
      const r = parseJumpInput("2023-02-29", today);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/february.*28.*days/i);
    });

    it("accepts Feb 29 in a leap year", () => {
      const r = parseJumpInput("2024-02-29", today);
      expect(r.ok).toBe(true);
    });

    it("rejects year < 2000", () => {
      const r = parseJumpInput("1999-12-31", today);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/out of range/i);
    });

    it("rejects year > 2099", () => {
      const r = parseJumpInput("2100-01-01", today);
      expect(r.ok).toBe(false);
    });

    it("rejects 226 (typo attractor)", () => {
      const r = parseJumpInput("226-03-15", today);
      // Doesn't match the YYYY-MM-DD regex (3-digit year), so falls
      // through to the "isn't a date" generic message.
      expect(r.ok).toBe(false);
    });
  });

  describe("YYYY-MM month", () => {
    it("parses a valid month to its first day", () => {
      const r = parseJumpInput("2022-03", today);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.date).toBe("2022-03-01");
    });

    it("rejects month=13", () => {
      const r = parseJumpInput("2022-13", today);
      expect(r.ok).toBe(false);
    });
  });

  describe("YYYY-Qn quarter", () => {
    it("parses Q1 to January 1", () => {
      const r = parseJumpInput("2022-Q1", today);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.date).toBe("2022-01-01");
    });

    it("parses Q2 to April 1", () => {
      const r = parseJumpInput("2022-Q2", today);
      if (r.ok) expect(r.date).toBe("2022-04-01");
    });

    it("parses Q3 to July 1", () => {
      const r = parseJumpInput("2022-Q3", today);
      if (r.ok) expect(r.date).toBe("2022-07-01");
    });

    it("parses Q4 to October 1", () => {
      const r = parseJumpInput("2022-Q4", today);
      if (r.ok) expect(r.date).toBe("2022-10-01");
    });

    it("is case-insensitive on the Q", () => {
      const r = parseJumpInput("2022-q1", today);
      expect(r.ok).toBe(true);
    });

    it("rejects Q5", () => {
      const r = parseJumpInput("2022-Q5", today);
      expect(r.ok).toBe(false);
    });
  });

  describe("garbage input", () => {
    it("rejects empty input", () => {
      const r = parseJumpInput("", today);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/enter a date/i);
    });

    it("rejects whitespace-only input", () => {
      expect(parseJumpInput("   ", today).ok).toBe(false);
    });

    it("rejects free-form English", () => {
      const r = parseJumpInput("next Tuesday", today);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/2026-03-15.*today.*yesterday/i);
    });

    it("rejects Excel-style dates (4/15/2026)", () => {
      const r = parseJumpInput("4/15/2026", today);
      expect(r.ok).toBe(false);
    });
  });

  describe("resolvedLabel", () => {
    it("renders a long label for exact dates", () => {
      const r = parseJumpInput("2024-04-15", today);
      if (r.ok) expect(r.resolvedLabel).toMatch(/Apr 15, 2024/);
    });

    it("renders the month + year for YYYY-MM", () => {
      const r = parseJumpInput("2022-03", today);
      if (r.ok) expect(r.resolvedLabel).toBe("March 2022");
    });

    it("renders the quarter span for YYYY-Qn", () => {
      const r = parseJumpInput("2022-Q1", today);
      if (r.ok) expect(r.resolvedLabel).toMatch(/Q1.*January 1.*March 31/);
    });
  });
});

describe("resolveChip", () => {
  const ctx = {
    todayLocal: "2026-05-04",
    // Real getLocalWeekStart returns Monday of the given date's week.
    // 2026-05-04 is a Monday, so getLocalWeekStart("2026-05-04")="2026-05-04".
    getLocalWeekStart: (d: string) => d, // simple stub for testing
  };

  it("today returns the today date", () => {
    expect(resolveChip("today", ctx).date).toBe("2026-05-04");
  });

  it("yesterday subtracts one day", () => {
    expect(resolveChip("yesterday", ctx).date).toBe("2026-05-03");
  });

  it("last week subtracts 7 from this week's Monday", () => {
    expect(resolveChip("lastWeek", ctx).date).toBe("2026-04-27");
  });

  it("last month is the first of the prior month", () => {
    expect(resolveChip("lastMonth", ctx).date).toBe("2026-04-01");
  });

  it("last month wraps year on January", () => {
    const r = resolveChip("lastMonth", {
      ...ctx,
      todayLocal: "2026-01-15",
    });
    expect(r.date).toBe("2025-12-01");
  });

  it("last quarter is the first month of the prior quarter", () => {
    // May 2026 is Q2; last quarter is Q1 → 2026-01-01.
    expect(resolveChip("lastQuarter", ctx).date).toBe("2026-01-01");
  });

  it("last quarter wraps year on Q1", () => {
    // Feb 2026 is Q1; last quarter is Q4 of 2025 → 2025-10-01.
    const r = resolveChip("lastQuarter", {
      ...ctx,
      todayLocal: "2026-02-15",
    });
    expect(r.date).toBe("2025-10-01");
  });
});
