import { describe, it, expect } from "vitest";
import {
  detectAgentOverlaps,
  sumAgentMinutes,
  type OverlapEntry,
} from "./agent-overlap";

/** Builder with sane defaults — tests override only what matters. */
function entry(overrides: Partial<OverlapEntry> & { id: string }): OverlapEntry {
  return {
    userId: "u1",
    projectId: "p1",
    startedByKind: "user",
    startTime: "2026-07-18T09:00:00+00:00",
    endTime: "2026-07-18T10:00:00+00:00",
    description: null,
    ...overrides,
  };
}

describe("detectAgentOverlaps", () => {
  it("flags an agent entry that overlaps a human entry (same user, same project)", () => {
    const conflicts = detectAgentOverlaps([
      entry({
        id: "human",
        description: "Sprint planning",
        startTime: "2026-07-18T09:00:00+00:00",
        endTime: "2026-07-18T10:00:00+00:00",
      }),
      entry({
        id: "agent",
        startedByKind: "agent",
        startTime: "2026-07-18T09:30:00+00:00",
        endTime: "2026-07-18T11:00:00+00:00",
      }),
    ]);
    expect(conflicts.size).toBe(1);
    const conflict = conflicts.get("agent");
    expect(conflict).toEqual({
      agentEntryId: "agent",
      conflictingEntryId: "human",
      conflictingDescription: "Sprint planning",
      conflictingDate: "2026-07-18",
    });
  });

  it("compares timestamps numerically — Postgres '+00:00' vs JS 'Z' suffixes overlap correctly", () => {
    // Same instant expressed both ways; string comparison would
    // mis-order these ("...Z" > "...+00:00" lexically).
    const conflicts = detectAgentOverlaps([
      entry({
        id: "human",
        startTime: "2026-07-18T09:00:00+00:00",
        endTime: "2026-07-18T10:00:00+00:00",
      }),
      entry({
        id: "agent",
        startedByKind: "agent",
        startTime: "2026-07-18T09:59:00Z",
        endTime: "2026-07-18T10:30:00Z",
      }),
    ]);
    expect(conflicts.has("agent")).toBe(true);
  });

  it("does NOT flag touching ranges (agent starts exactly when human ends)", () => {
    const conflicts = detectAgentOverlaps([
      entry({
        id: "human",
        startTime: "2026-07-18T09:00:00+00:00",
        endTime: "2026-07-18T10:00:00+00:00",
      }),
      entry({
        id: "agent",
        startedByKind: "agent",
        startTime: "2026-07-18T10:00:00+00:00",
        endTime: "2026-07-18T11:00:00+00:00",
      }),
    ]);
    expect(conflicts.size).toBe(0);
  });

  it("does NOT flag touching ranges (agent ends exactly when human starts)", () => {
    const conflicts = detectAgentOverlaps([
      entry({
        id: "human",
        startTime: "2026-07-18T10:00:00+00:00",
        endTime: "2026-07-18T11:00:00+00:00",
      }),
      entry({
        id: "agent",
        startedByKind: "agent",
        startTime: "2026-07-18T09:00:00+00:00",
        endTime: "2026-07-18T10:00:00+00:00",
      }),
    ]);
    expect(conflicts.size).toBe(0);
  });

  it("flags full containment in both directions", () => {
    const conflicts = detectAgentOverlaps([
      // Agent inside human
      entry({ id: "h1", startTime: "2026-07-18T08:00:00Z", endTime: "2026-07-18T12:00:00Z" }),
      entry({
        id: "a1",
        startedByKind: "agent",
        startTime: "2026-07-18T09:00:00Z",
        endTime: "2026-07-18T10:00:00Z",
      }),
      // Human inside agent — different project so the pairs stay isolated
      entry({
        id: "h2",
        projectId: "p2",
        startTime: "2026-07-18T14:00:00Z",
        endTime: "2026-07-18T14:30:00Z",
      }),
      entry({
        id: "a2",
        projectId: "p2",
        startedByKind: "agent",
        startTime: "2026-07-18T13:00:00Z",
        endTime: "2026-07-18T16:00:00Z",
      }),
    ]);
    expect(conflicts.get("a1")?.conflictingEntryId).toBe("h1");
    expect(conflicts.get("a2")?.conflictingEntryId).toBe("h2");
  });

  it("skips open-ended running entries (null end_time) on either side", () => {
    const conflicts = detectAgentOverlaps([
      entry({ id: "human-running", endTime: null }),
      entry({
        id: "agent",
        startedByKind: "agent",
        startTime: "2026-07-18T09:30:00Z",
        endTime: "2026-07-18T10:30:00Z",
      }),
      entry({
        id: "agent-running",
        startedByKind: "agent",
        startTime: "2026-07-18T09:30:00Z",
        endTime: null,
      }),
      entry({ id: "human-null-start", startTime: null }),
    ]);
    expect(conflicts.size).toBe(0);
  });

  it("skips entries with unparseable timestamps", () => {
    const conflicts = detectAgentOverlaps([
      entry({ id: "human", startTime: "not-a-date", endTime: "also-not" }),
      entry({
        id: "agent",
        startedByKind: "agent",
        startTime: "2026-07-18T09:00:00Z",
        endTime: "2026-07-18T10:00:00Z",
      }),
    ]);
    expect(conflicts.size).toBe(0);
  });

  it("does NOT flag overlap across different projects (concurrency is the point)", () => {
    const conflicts = detectAgentOverlaps([
      entry({ id: "human", projectId: "p1" }),
      entry({
        id: "agent",
        projectId: "p2",
        startedByKind: "agent",
        startTime: "2026-07-18T09:15:00Z",
        endTime: "2026-07-18T09:45:00Z",
      }),
    ]);
    expect(conflicts.size).toBe(0);
  });

  it("does NOT flag overlap across different users (parallel teammates)", () => {
    const conflicts = detectAgentOverlaps([
      entry({ id: "human", userId: "u1" }),
      entry({
        id: "agent",
        userId: "u2",
        startedByKind: "agent",
        startTime: "2026-07-18T09:15:00Z",
        endTime: "2026-07-18T09:45:00Z",
      }),
    ]);
    expect(conflicts.size).toBe(0);
  });

  it("ignores same-kind pairs (agent-agent and user-user overlaps)", () => {
    const conflicts = detectAgentOverlaps([
      entry({
        id: "a1",
        startedByKind: "agent",
        startTime: "2026-07-18T09:00:00Z",
        endTime: "2026-07-18T10:00:00Z",
      }),
      entry({
        id: "a2",
        startedByKind: "agent",
        startTime: "2026-07-18T09:30:00Z",
        endTime: "2026-07-18T10:30:00Z",
      }),
      entry({ id: "u1a", startTime: "2026-07-18T11:00:00Z", endTime: "2026-07-18T12:00:00Z" }),
      entry({ id: "u1b", startTime: "2026-07-18T11:30:00Z", endTime: "2026-07-18T12:30:00Z" }),
    ]);
    expect(conflicts.size).toBe(0);
  });

  it("ignores 'integration' and 'import' kinds on both sides", () => {
    const conflicts = detectAgentOverlaps([
      entry({ id: "imported", startedByKind: "import" }),
      entry({ id: "integrated", startedByKind: "integration" }),
      entry({
        id: "agent",
        startedByKind: "agent",
        startTime: "2026-07-18T09:15:00Z",
        endTime: "2026-07-18T09:45:00Z",
      }),
    ]);
    expect(conflicts.size).toBe(0);
  });

  it("reports the earliest-starting human entry when several overlap", () => {
    const conflicts = detectAgentOverlaps([
      entry({
        id: "later-human",
        description: "Afternoon review",
        startTime: "2026-07-18T10:00:00Z",
        endTime: "2026-07-18T11:00:00Z",
      }),
      entry({
        id: "earlier-human",
        description: "Morning standup",
        startTime: "2026-07-18T08:30:00Z",
        endTime: "2026-07-18T09:30:00Z",
      }),
      entry({
        id: "agent",
        startedByKind: "agent",
        startTime: "2026-07-18T09:00:00Z",
        endTime: "2026-07-18T10:30:00Z",
      }),
    ]);
    expect(conflicts.get("agent")?.conflictingEntryId).toBe("earlier-human");
    expect(conflicts.get("agent")?.conflictingDescription).toBe(
      "Morning standup",
    );
  });

  it("flags each overlapping agent entry independently", () => {
    const conflicts = detectAgentOverlaps([
      entry({ id: "human", startTime: "2026-07-18T09:00:00Z", endTime: "2026-07-18T12:00:00Z" }),
      entry({
        id: "a1",
        startedByKind: "agent",
        startTime: "2026-07-18T09:30:00Z",
        endTime: "2026-07-18T10:00:00Z",
      }),
      entry({
        id: "a2",
        startedByKind: "agent",
        startTime: "2026-07-18T11:00:00Z",
        endTime: "2026-07-18T11:30:00Z",
      }),
      entry({
        id: "a3-clear",
        startedByKind: "agent",
        startTime: "2026-07-18T13:00:00Z",
        endTime: "2026-07-18T14:00:00Z",
      }),
    ]);
    expect(conflicts.size).toBe(2);
    expect(conflicts.has("a1")).toBe(true);
    expect(conflicts.has("a2")).toBe(true);
    expect(conflicts.has("a3-clear")).toBe(false);
  });

  it("flags a zero-duration agent entry strictly inside a human range, but not at a boundary", () => {
    const conflicts = detectAgentOverlaps([
      entry({ id: "human", startTime: "2026-07-18T09:00:00Z", endTime: "2026-07-18T10:00:00Z" }),
      // Zero-length inside the range: 09:30 < 10:00 && 09:30 > 09:00.
      entry({
        id: "a-inside",
        startedByKind: "agent",
        startTime: "2026-07-18T09:30:00Z",
        endTime: "2026-07-18T09:30:00Z",
      }),
      // Zero-length exactly at the human end: touching, not overlap.
      entry({
        id: "a-boundary",
        startedByKind: "agent",
        startTime: "2026-07-18T10:00:00Z",
        endTime: "2026-07-18T10:00:00Z",
      }),
    ]);
    expect(conflicts.has("a-inside")).toBe(true);
    expect(conflicts.has("a-boundary")).toBe(false);
  });

  it("never matches inverted ranges (end before start, e.g. bad import data)", () => {
    const conflicts = detectAgentOverlaps([
      entry({ id: "human", startTime: "2026-07-18T09:00:00Z", endTime: "2026-07-18T10:00:00Z" }),
      entry({
        id: "a-inverted",
        startedByKind: "agent",
        startTime: "2026-07-18T09:45:00Z",
        endTime: "2026-07-18T09:15:00Z",
      }),
    ]);
    expect(conflicts.size).toBe(0);
  });

  it("reports conflictingDate as the UTC day of the conflicting start (matches the builder's date column)", () => {
    // 22:00 on the 17th in UTC-7 is 05:00 on the 18th UTC. The
    // builder's per-entry `date` is also derived from the UTC ISO
    // string (page.tsx slices start_time), so UTC-day is the
    // consistent choice for the tooltip fallback here.
    const conflicts = detectAgentOverlaps([
      entry({
        id: "human",
        startTime: "2026-07-17T22:00:00-07:00",
        endTime: "2026-07-17T23:30:00-07:00",
      }),
      entry({
        id: "agent",
        startedByKind: "agent",
        startTime: "2026-07-18T05:30:00Z",
        endTime: "2026-07-18T06:30:00Z",
      }),
    ]);
    expect(conflicts.get("agent")?.conflictingDate).toBe("2026-07-18");
  });

  it("returns an empty map for empty input", () => {
    expect(detectAgentOverlaps([]).size).toBe(0);
  });
});

describe("sumAgentMinutes", () => {
  it("sums only agent-started entries", () => {
    expect(
      sumAgentMinutes([
        { startedByKind: "agent", durationMin: 30 },
        { startedByKind: "user", durationMin: 60 },
        { startedByKind: "agent", durationMin: 45 },
        { startedByKind: "import", durationMin: 120 },
        { startedByKind: "integration", durationMin: 15 },
      ]),
    ).toBe(75);
  });

  it("returns 0 when there are no agent entries", () => {
    expect(sumAgentMinutes([{ startedByKind: "user", durationMin: 60 }])).toBe(0);
    expect(sumAgentMinutes([])).toBe(0);
  });
});
