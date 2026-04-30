import { describe, it, expect } from "vitest";
import { formatTimerStarted, entryDeepLink } from "./timer-started";

// Pin a "now" so the relative-day math is deterministic.
// 2026-04-30 14:00:00 in the runtime's local TZ.
const NOW = new Date(2026, 3, 30, 14, 0, 0).getTime();

function localIso(year: number, month1based: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month1based - 1, day, hour, minute).toISOString();
}

describe("formatTimerStarted", () => {
  it("shows time only when started today", () => {
    const start = localIso(2026, 4, 30, 9, 15);
    const out = formatTimerStarted(start, NOW, "en-US");
    expect(out).toMatch(/^Started/);
    // No "ago" / "yesterday" / weekday for same-day
    expect(out).not.toContain("ago");
    expect(out).not.toContain("yesterday");
  });

  it("shows 'yesterday' when started 1 day ago", () => {
    const start = localIso(2026, 4, 29, 15, 42);
    const out = formatTimerStarted(start, NOW, "en-US");
    expect(out).toContain("yesterday");
  });

  it("shows weekday + (Nd ago) for 2-6 days ago", () => {
    const start = localIso(2026, 4, 27, 10, 0); // Monday
    const out = formatTimerStarted(start, NOW, "en-US");
    expect(out).toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
    expect(out).toContain("3d ago");
  });

  it("shows full month + day + (Nd ago) for ≥7 days ago in the same year", () => {
    const start = localIso(2026, 3, 1, 9, 30);
    const out = formatTimerStarted(start, NOW, "en-US");
    expect(out).toContain("Mar");
    expect(out).toContain("ago");
    // Same year → no year label
    expect(out).not.toContain("2026");
  });

  it("includes year for cross-year entries (the forgotten-Harvest-timer case)", () => {
    const start = localIso(2025, 4, 15, 9, 30);
    const out = formatTimerStarted(start, NOW, "en-US");
    expect(out).toContain("2025");
    expect(out).toMatch(/\d+d ago/);
  });

  it("returns a graceful placeholder for an unparseable input", () => {
    expect(formatTimerStarted("not-a-date", NOW, "en-US")).toBe("Started —");
  });
});

describe("entryDeepLink", () => {
  it("builds an anchor URL with view=day + entry hash", () => {
    const start = localIso(2026, 4, 15, 9, 30);
    const url = entryDeepLink(start, "abc-123");
    expect(url).toBe("/time-entries?view=day&anchor=2026-04-15#entry-abc-123");
  });
});
