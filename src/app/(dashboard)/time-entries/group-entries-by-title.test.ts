import { describe, it, expect } from "vitest";
import {
  groupEntriesByTitle,
  displayDescription,
} from "./group-entries-by-title";
import type { TimeEntry } from "./types";

describe("displayDescription", () => {
  it("strips a leading ticket-key prefix", () => {
    expect(displayDescription("AE-644", "AE-644 Amplify Gen 2 cutover")).toBe(
      "Amplify Gen 2 cutover",
    );
  });

  it("strips the key with a separator", () => {
    expect(displayDescription("AE-1", "AE-1: fix login")).toBe("fix login");
    expect(displayDescription("AE-1", "AE-1 - fix login")).toBe("fix login");
  });

  it("is case-insensitive on the key", () => {
    expect(displayDescription("ae-1", "AE-1 fix login")).toBe("fix login");
  });

  it("never empties the description (key-only stays as the key)", () => {
    expect(displayDescription("AE-644", "AE-644")).toBe("AE-644");
  });

  it("does not strip an inline mention or a non-matching prefix", () => {
    expect(displayDescription("AE-644", "see AE-644 for context")).toBe(
      "see AE-644 for context",
    );
    expect(displayDescription("AE-6", "AE-644 cutover")).toBe("AE-644 cutover");
  });

  it("leaves the description untouched when there is no ticket key", () => {
    expect(displayDescription(null, "Testing framework")).toBe(
      "Testing framework",
    );
  });

  it("handles null/empty description", () => {
    expect(displayDescription("AE-1", null)).toBe("");
    expect(displayDescription("AE-1", "   ")).toBe("");
  });
});

/** Minimal entry factory. Unlike the week-entry-row test's helper this
 *  one defaults `description` to a *fixed* value so the null/empty cases
 *  can be exercised explicitly (the other helper's `desc-${id}` default
 *  masks them). */
function makeEntry(id: string, overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id,
    team_id: "o1",
    user_id: "u1",
    project_id: "p1",
    description: "Work",
    start_time: "2026-05-05T09:00:00Z",
    end_time: "2026-05-05T10:00:00Z",
    duration_min: 60,
    billable: true,
    github_issue: null,
    linked_ticket_provider: null,
    linked_ticket_key: null,
    linked_ticket_url: null,
    linked_ticket_title: null,
    linked_ticket_refreshed_at: null,
    invoiced: false,
    invoice_id: null,
    invoice_number: null,
    category_id: null,
    projects: null,
    author: { user_id: "u1", display_name: "Marcus", avatar_url: null },
    ...overrides,
  };
}

/** Empty length-7 matrix, optionally seeded with per-day entries. */
function grid(byDay: Partial<Record<number, TimeEntry[]>> = {}): TimeEntry[][] {
  return Array.from({ length: 7 }, (_, d) => byDay[d] ?? []);
}

describe("groupEntriesByTitle", () => {
  it("returns no lines for an empty grid", () => {
    expect(groupEntriesByTitle(grid())).toEqual([]);
  });

  it("keeps a single entry as one line with its duration on its day", () => {
    const lines = groupEntriesByTitle(
      grid({ 1: [makeEntry("a", { duration_min: 90 })] }),
    );
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.entryCount).toBe(1);
    expect(line.byDay).toEqual([0, 90, 0, 0, 0, 0, 0]);
    expect(line.totalMin).toBe(90);
    expect(line.hasCollision).toBe(false);
    expect(line.invoicedState).toBe("none");
  });

  it("spreads same-title entries across distinct days onto one line", () => {
    // The screenshot case: AE-644 on Mon/Tue/Wed.
    const ticket = {
      linked_ticket_key: "AE-644",
      linked_ticket_provider: "jira" as const,
      linked_ticket_url: "https://x/AE-644",
      description: "cutover implementation",
    };
    const lines = groupEntriesByTitle(
      grid({
        0: [makeEntry("a", { ...ticket, duration_min: 60 })],
        1: [makeEntry("b", { ...ticket, duration_min: 210 })],
        2: [makeEntry("c", { ...ticket, duration_min: 90 })],
      }),
    );
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.ticketKey).toBe("AE-644");
    expect(line.byDay).toEqual([60, 210, 90, 0, 0, 0, 0]);
    expect(line.totalMin).toBe(360);
    expect(line.entryCount).toBe(3);
    expect(line.hasCollision).toBe(false); // distinct days
  });

  it("produces one line per distinct title", () => {
    const lines = groupEntriesByTitle(
      grid({
        0: [makeEntry("a", { description: "Alpha" })],
        1: [makeEntry("b", { description: "Beta" })],
      }),
    );
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.description)).toEqual(["Alpha", "Beta"]);
  });

  it("merges a same-day collision into one line and flags it", () => {
    const lines = groupEntriesByTitle(
      grid({
        4: [
          makeEntry("a", { description: "Testing framework", duration_min: 30 }),
          makeEntry("b", { description: "Testing framework", duration_min: 45 }),
        ],
      }),
    );
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.byDay[4]).toBe(75); // summed
    expect(line.entriesByDay[4]).toHaveLength(2);
    expect(line.entryCount).toBe(2);
    expect(line.hasCollision).toBe(true);
  });

  it("keeps billable and non-billable same-title entries on separate lines", () => {
    const lines = groupEntriesByTitle(
      grid({
        0: [makeEntry("a", { description: "AE-644", billable: true })],
        1: [makeEntry("b", { description: "AE-644", billable: false })],
      }),
    );
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.billable).sort()).toEqual([false, true]);
  });

  it("does not merge across differing ticket keys with identical descriptions", () => {
    const lines = groupEntriesByTitle(
      grid({
        0: [makeEntry("a", { linked_ticket_key: "AE-1", description: "cutover" })],
        1: [makeEntry("b", { linked_ticket_key: "AE-2", description: "cutover" })],
      }),
    );
    expect(lines).toHaveLength(2);
  });

  it("does not merge same ticket with differing descriptions", () => {
    const lines = groupEntriesByTitle(
      grid({
        0: [makeEntry("a", { linked_ticket_key: "AE-1", description: "morning" })],
        1: [makeEntry("b", { linked_ticket_key: "AE-1", description: "afternoon" })],
      }),
    );
    expect(lines).toHaveLength(2);
  });

  it("trims whitespace but is case-sensitive in the merge key", () => {
    const merged = groupEntriesByTitle(
      grid({
        0: [makeEntry("a", { description: "  Fix login  " })],
        1: [makeEntry("b", { description: "Fix login" })],
      }),
    );
    expect(merged).toHaveLength(1);

    const cased = groupEntriesByTitle(
      grid({
        0: [makeEntry("a", { description: "Fix" })],
        1: [makeEntry("b", { description: "fix" })],
      }),
    );
    expect(cased).toHaveLength(2);
  });

  it("groups null and empty descriptions into one untitled line per ticket", () => {
    const lines = groupEntriesByTitle(
      grid({
        0: [makeEntry("a", { description: null })],
        1: [makeEntry("b", { description: "" })],
        2: [makeEntry("c", { description: "   " })],
      }),
    );
    // null, "", and whitespace-only all trim to "" → one line.
    expect(lines).toHaveLength(1);
    expect(lines[0]!.entryCount).toBe(3);
  });

  it("keeps untitled entries on different tickets separate", () => {
    const lines = groupEntriesByTitle(
      grid({
        0: [makeEntry("a", { description: null, linked_ticket_key: "AE-1" })],
        1: [makeEntry("b", { description: null, linked_ticket_key: "AE-2" })],
      }),
    );
    expect(lines).toHaveLength(2);
  });

  it("reports invoiced state as partial when some entries are billed", () => {
    const lines = groupEntriesByTitle(
      grid({
        0: [
          makeEntry("a", {
            description: "AE-9",
            invoiced: true,
            invoice_id: "inv-1",
          }),
        ],
        1: [makeEntry("b", { description: "AE-9" })],
      }),
    );
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.invoicedState).toBe("partial");
    expect(line.invoicedByDay[0]).toBe(true);
    expect(line.invoicedByDay[1]).toBe(false);
    expect(line.invoiceIdByDay[0]).toBe("inv-1");
  });

  it("reports invoiced state as all when every entry is billed", () => {
    const lines = groupEntriesByTitle(
      grid({
        0: [
          makeEntry("a", {
            description: "AE-9",
            invoiced: true,
            invoice_id: "inv-1",
          }),
        ],
        1: [
          makeEntry("b", {
            description: "AE-9",
            invoiced: true,
            invoice_id: "inv-1",
          }),
        ],
      }),
    );
    expect(lines[0]!.invoicedState).toBe("all");
  });

  it("keeps the first invoice id when a day mixes invoiced entries", () => {
    const lines = groupEntriesByTitle(
      grid({
        0: [
          makeEntry("a", {
            description: "AE-9",
            start_time: "2026-05-05T08:00:00Z",
            invoiced: true,
            invoice_id: "inv-first",
          }),
          makeEntry("b", {
            description: "AE-9",
            start_time: "2026-05-05T09:00:00Z",
            invoiced: true,
            invoice_id: "inv-second",
          }),
        ],
      }),
    );
    expect(lines[0]!.invoiceIdByDay[0]).toBe("inv-first");
  });

  it("flags a running entry and sums only committed minutes", () => {
    const lines = groupEntriesByTitle(
      grid({
        0: [
          makeEntry("a", { description: "AE-9", duration_min: 30 }),
          makeEntry("b", {
            description: "AE-9",
            end_time: null,
            duration_min: 0,
          }),
        ],
      }),
    );
    const line = lines[0]!;
    expect(line.hasRunning).toBe(true);
    expect(line.byDay[0]).toBe(30); // running entry contributes 0 committed
  });

  it("orders lines by earliest start_time, deterministically across runs", () => {
    const input = grid({
      0: [makeEntry("late", { description: "Late", start_time: "2026-05-05T15:00:00Z" })],
      1: [makeEntry("early", { description: "Early", start_time: "2026-05-04T08:00:00Z" })],
    });
    const first = groupEntriesByTitle(input).map((l) => l.description);
    const second = groupEntriesByTitle(input).map((l) => l.description);
    expect(first).toEqual(["Early", "Late"]);
    expect(second).toEqual(first); // stable
  });

  it("ignores a malformed out-of-range day bucket", () => {
    const matrix = grid({ 0: [makeEntry("a")] });
    matrix.push([makeEntry("oops")]); // index 7, out of week
    const lines = groupEntriesByTitle(matrix);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.entryCount).toBe(1);
  });
});
