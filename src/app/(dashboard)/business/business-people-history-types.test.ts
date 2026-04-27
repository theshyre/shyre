import { describe, it, expect } from "vitest";
import {
  buildActorNameMap,
  buildPersonNameMap,
  resolveBusinessPeopleHistoryEntries,
  type RawBusinessPeopleHistoryRow,
} from "./business-people-history-types";

describe("buildPersonNameMap", () => {
  it("prefers preferred_name when set", () => {
    const m = buildPersonNameMap([
      { id: "p1", legal_name: "Robert Smith", preferred_name: "Bob" },
    ]);
    expect(m.get("p1")).toBe("Bob");
  });

  it("falls back to legal_name when preferred_name is null", () => {
    const m = buildPersonNameMap([
      { id: "p1", legal_name: "Robert Smith", preferred_name: null },
    ]);
    expect(m.get("p1")).toBe("Robert Smith");
  });

  it("collapses an empty legal_name into Unknown rather than empty string", () => {
    const m = buildPersonNameMap([
      { id: "p1", legal_name: "", preferred_name: null },
    ]);
    expect(m.get("p1")).toBe("Unknown");
  });

  it("returns an empty map for empty input", () => {
    expect(buildPersonNameMap([])).toEqual(new Map());
  });

  it("preserves entry order and returns one entry per id", () => {
    const m = buildPersonNameMap([
      { id: "p1", legal_name: "Alice", preferred_name: null },
      { id: "p2", legal_name: "Robert", preferred_name: "Bob" },
    ]);
    expect(m.size).toBe(2);
    expect(Array.from(m.keys())).toEqual(["p1", "p2"]);
  });
});

describe("buildActorNameMap", () => {
  it("maps user_id to display_name when set", () => {
    const m = buildActorNameMap([{ user_id: "u1", display_name: "Marcus" }]);
    expect(m.get("u1")).toBe("Marcus");
  });

  it("preserves null display_name (profile exists but no name set)", () => {
    const m = buildActorNameMap([{ user_id: "u1", display_name: null }]);
    expect(m.get("u1")).toBeNull();
    expect(m.has("u1")).toBe(true); // distinct from "missing"
  });

  it("returns an empty map for empty input", () => {
    expect(buildActorNameMap([])).toEqual(new Map());
  });
});

describe("resolveBusinessPeopleHistoryEntries", () => {
  const baseRow: RawBusinessPeopleHistoryRow = {
    id: "evt-1",
    business_person_id: "bp-1",
    operation: "UPDATE",
    changed_at: "2026-04-15T13:30:00Z",
    changed_by_user_id: "u-actor",
    previous_state: { legal_name: "Robert Smith", title: "Senior" },
  };

  it("resolves person display name from the live lookup map first", () => {
    const out = resolveBusinessPeopleHistoryEntries({
      rows: [baseRow],
      actorNameById: new Map([["u-actor", "Marcus"]]),
      personNameById: new Map([["bp-1", "Bob (preferred)"]]),
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.personDisplayName).toBe("Bob (preferred)");
    expect(out[0]?.personId).toBe("bp-1");
  });

  it("falls back to the snapshot's legal_name when the live person isn't in the map", () => {
    const out = resolveBusinessPeopleHistoryEntries({
      rows: [baseRow],
      actorNameById: new Map(),
      personNameById: new Map(), // person is gone
    });
    expect(out[0]?.personDisplayName).toBe("Robert Smith");
  });

  it("falls back to the configurable fallback when even legal_name is missing", () => {
    const out = resolveBusinessPeopleHistoryEntries({
      rows: [{ ...baseRow, previous_state: null }],
      actorNameById: new Map(),
      personNameById: new Map(),
      fallbackPersonName: "Anonymous",
    });
    expect(out[0]?.personDisplayName).toBe("Anonymous");
  });

  it("default fallback is 'Unknown person'", () => {
    const out = resolveBusinessPeopleHistoryEntries({
      rows: [{ ...baseRow, previous_state: null }],
      actorNameById: new Map(),
      personNameById: new Map(),
    });
    expect(out[0]?.personDisplayName).toBe("Unknown person");
  });

  it("resolves actor displayName from the lookup map", () => {
    const out = resolveBusinessPeopleHistoryEntries({
      rows: [baseRow],
      actorNameById: new Map([["u-actor", "Marcus"]]),
      personNameById: new Map([["bp-1", "Bob"]]),
    });
    expect(out[0]?.changedBy.userId).toBe("u-actor");
    expect(out[0]?.changedBy.displayName).toBe("Marcus");
    expect(out[0]?.changedBy.email).toBeNull();
  });

  it("treats a missing actor (system change, deleted user) as null displayName", () => {
    const out = resolveBusinessPeopleHistoryEntries({
      rows: [{ ...baseRow, changed_by_user_id: null }],
      actorNameById: new Map(),
      personNameById: new Map(),
    });
    expect(out[0]?.changedBy.userId).toBeNull();
    expect(out[0]?.changedBy.displayName).toBeNull();
  });

  it("preserves the previous_state JSONB unchanged", () => {
    const out = resolveBusinessPeopleHistoryEntries({
      rows: [baseRow],
      actorNameById: new Map(),
      personNameById: new Map(),
    });
    expect(out[0]?.previousState).toEqual({
      legal_name: "Robert Smith",
      title: "Senior",
    });
  });

  it("treats null previous_state as an empty object", () => {
    const out = resolveBusinessPeopleHistoryEntries({
      rows: [{ ...baseRow, previous_state: null }],
      actorNameById: new Map(),
      personNameById: new Map(),
    });
    expect(out[0]?.previousState).toEqual({});
  });

  it("preserves DELETE operation through the mapping", () => {
    const out = resolveBusinessPeopleHistoryEntries({
      rows: [{ ...baseRow, operation: "DELETE" }],
      actorNameById: new Map(),
      personNameById: new Map(),
    });
    expect(out[0]?.operation).toBe("DELETE");
  });

  it("returns an empty array when given no rows", () => {
    const out = resolveBusinessPeopleHistoryEntries({
      rows: [],
      actorNameById: new Map(),
      personNameById: new Map(),
    });
    expect(out).toEqual([]);
  });
});
