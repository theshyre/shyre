import { describe, it, expect } from "vitest";
import {
  buildBusinessHistoryEntry,
  buildRegistrationHistoryEntry,
  mergeIdentityHistoryRows,
  identityGroupKey,
  type RawBusinessHistoryRow,
  type RawRegistrationHistoryRow,
} from "./identity-history-types";

describe("buildBusinessHistoryEntry", () => {
  const baseRow: RawBusinessHistoryRow = {
    id: "evt-1",
    operation: "UPDATE",
    changed_at: "2026-04-15T13:30:00Z",
    changed_by_user_id: "u-actor",
    previous_state: { legal_name: "Acme LLC", entity_type: "llc" },
  };

  it("uses the snapshot's legal_name as the rowLabel when present", () => {
    const e = buildBusinessHistoryEntry(baseRow, "Acme LLC (current)");
    expect(e.rowLabel).toBe("Acme LLC");
    expect(e.kind).toBe("business");
    expect(e.registrationId).toBe("");
    expect(e.changedBy.userId).toBe("u-actor");
    expect(e.previousState).toEqual({ legal_name: "Acme LLC", entity_type: "llc" });
  });

  it("falls back to liveBusinessName when the snapshot has no legal_name", () => {
    const e = buildBusinessHistoryEntry(
      { ...baseRow, previous_state: { entity_type: "llc" } },
      "Live Name LLC",
    );
    expect(e.rowLabel).toBe("Live Name LLC");
  });

  it("falls back when previous_state is null", () => {
    const e = buildBusinessHistoryEntry(
      { ...baseRow, previous_state: null },
      "Fallback Name",
    );
    expect(e.rowLabel).toBe("Fallback Name");
    expect(e.previousState).toEqual({});
  });

  it("preserves DELETE operation through the mapping", () => {
    const e = buildBusinessHistoryEntry(
      { ...baseRow, operation: "DELETE" },
      "Acme",
    );
    expect(e.operation).toBe("DELETE");
  });
});

describe("buildRegistrationHistoryEntry", () => {
  const baseRow: RawRegistrationHistoryRow = {
    id: "evt-2",
    registration_id: "reg-1",
    operation: "UPDATE",
    changed_at: "2026-04-15T13:30:00Z",
    changed_by_user_id: "u-actor",
    previous_state: {
      state: "DE",
      registration_type: "foreign_qualification",
    },
  };

  it("formats rowLabel as `<state> — <registration_type>` with underscores stripped", () => {
    const e = buildRegistrationHistoryEntry(baseRow);
    expect(e.rowLabel).toBe("DE — foreign qualification");
    expect(e.kind).toBe("registration");
    expect(e.registrationId).toBe("reg-1");
  });

  it("falls back when state and registration_type are missing", () => {
    const e = buildRegistrationHistoryEntry({
      ...baseRow,
      previous_state: {},
    });
    expect(e.rowLabel).toBe("— — registration");
  });

  it("preserves the source registration_id even after a DELETE", () => {
    const e = buildRegistrationHistoryEntry({
      ...baseRow,
      operation: "DELETE",
    });
    expect(e.registrationId).toBe("reg-1");
    expect(e.operation).toBe("DELETE");
  });
});

describe("mergeIdentityHistoryRows", () => {
  const liveName = "Acme LLC";
  const businessRow: RawBusinessHistoryRow = {
    id: "b-1",
    operation: "UPDATE",
    changed_at: "2026-04-15T13:30:00Z",
    changed_by_user_id: null,
    previous_state: { legal_name: "Acme LLC" },
  };
  const regRow: RawRegistrationHistoryRow = {
    id: "r-1",
    registration_id: "reg-1",
    operation: "UPDATE",
    changed_at: "2026-04-16T09:00:00Z",
    changed_by_user_id: null,
    previous_state: { state: "DE", registration_type: "formation" },
  };

  it("returns a single newest-first list across both tables", () => {
    const out = mergeIdentityHistoryRows({
      businessRows: [businessRow],
      registrationRows: [regRow],
      liveBusinessName: liveName,
    });
    expect(out.map((e) => e.id)).toEqual(["r-1", "b-1"]);
    expect(out[0]?.kind).toBe("registration");
    expect(out[1]?.kind).toBe("business");
  });

  it("returns business-only entries when no registration history exists", () => {
    const out = mergeIdentityHistoryRows({
      businessRows: [businessRow],
      registrationRows: [],
      liveBusinessName: liveName,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("business");
  });

  it("returns an empty array when both inputs are empty", () => {
    const out = mergeIdentityHistoryRows({
      businessRows: [],
      registrationRows: [],
      liveBusinessName: liveName,
    });
    expect(out).toEqual([]);
  });

  it("preserves order across multiple entries with strict timestamp comparison", () => {
    const earlier = { ...businessRow, id: "b-old", changed_at: "2026-01-01T00:00:00Z" };
    const later = { ...businessRow, id: "b-new", changed_at: "2026-06-01T00:00:00Z" };
    const reg = { ...regRow, id: "r-mid", changed_at: "2026-03-15T12:00:00Z" };
    const out = mergeIdentityHistoryRows({
      businessRows: [earlier, later],
      registrationRows: [reg],
      liveBusinessName: liveName,
    });
    expect(out.map((e) => e.id)).toEqual(["b-new", "r-mid", "b-old"]);
  });

  it("merges privateRows under kind=business and sorts with the rest", () => {
    const priv: RawBusinessHistoryRow = {
      id: "p-1",
      operation: "UPDATE",
      changed_at: "2026-04-17T12:00:00Z",
      changed_by_user_id: "u-actor",
      previous_state: { tax_id: "85-1234567" },
    };
    const out = mergeIdentityHistoryRows({
      businessRows: [businessRow],
      privateRows: [priv],
      registrationRows: [regRow],
      liveBusinessName: liveName,
    });
    // Private rows render as kind=business under the same group key
    // so the timeline can diff EIN changes alongside legal_name etc.
    expect(out.find((e) => e.id === "p-1")?.kind).toBe("business");
    expect(out.map((e) => e.id)).toEqual(["p-1", "r-1", "b-1"]);
  });
});

describe("identityGroupKey", () => {
  it("groups business entries together regardless of id", () => {
    const a = identityGroupKey({
      id: "evt-a",
      kind: "business",
      registrationId: "",
      rowLabel: "X",
      operation: "UPDATE",
      changedAt: "2026-01-01",
      changedBy: { userId: null, displayName: null, email: null },
      previousState: {},
    });
    const b = identityGroupKey({
      id: "evt-b",
      kind: "business",
      registrationId: "",
      rowLabel: "Y",
      operation: "DELETE",
      changedAt: "2026-02-01",
      changedBy: { userId: null, displayName: null, email: null },
      previousState: {},
    });
    expect(a).toBe(b);
  });

  it("partitions registrations by registrationId", () => {
    const r1 = identityGroupKey({
      id: "evt-1",
      kind: "registration",
      registrationId: "reg-1",
      rowLabel: "DE",
      operation: "UPDATE",
      changedAt: "2026-01-01",
      changedBy: { userId: null, displayName: null, email: null },
      previousState: {},
    });
    const r2 = identityGroupKey({
      id: "evt-2",
      kind: "registration",
      registrationId: "reg-2",
      rowLabel: "CA",
      operation: "UPDATE",
      changedAt: "2026-01-01",
      changedBy: { userId: null, displayName: null, email: null },
      previousState: {},
    });
    expect(r1).not.toBe(r2);
  });
});
