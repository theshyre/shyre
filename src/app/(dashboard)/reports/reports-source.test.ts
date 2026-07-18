import { describe, it, expect } from "vitest";
import {
  entryMatchesSource,
  resolveReportsSource,
  type ReportsSource,
} from "./reports-source";

describe("resolveReportsSource", () => {
  it("accepts the three valid values", () => {
    expect(resolveReportsSource("all")).toBe("all");
    expect(resolveReportsSource("human")).toBe("human");
    expect(resolveReportsSource("agent")).toBe("agent");
  });

  it("falls back to 'all' for unknown, empty, null, and undefined input", () => {
    expect(resolveReportsSource("robot")).toBe("all");
    expect(resolveReportsSource("AGENT")).toBe("all");
    expect(resolveReportsSource("")).toBe("all");
    expect(resolveReportsSource(null)).toBe("all");
    expect(resolveReportsSource(undefined)).toBe("all");
  });
});

describe("entryMatchesSource", () => {
  it("'all' matches every kind including null", () => {
    for (const kind of ["user", "agent", "integration", "import", null]) {
      expect(entryMatchesSource(kind, "all")).toBe(true);
    }
  });

  it("'agent' matches only agent-started entries", () => {
    expect(entryMatchesSource("agent", "agent")).toBe(true);
    expect(entryMatchesSource("user", "agent")).toBe(false);
    expect(entryMatchesSource("integration", "agent")).toBe(false);
    expect(entryMatchesSource("import", "agent")).toBe(false);
    expect(entryMatchesSource(null, "agent")).toBe(false);
  });

  it("'human' matches everything that is not agent (user, integration, import, null)", () => {
    expect(entryMatchesSource("user", "human")).toBe(true);
    expect(entryMatchesSource("integration", "human")).toBe(true);
    expect(entryMatchesSource("import", "human")).toBe(true);
    expect(entryMatchesSource(null, "human")).toBe(true);
    expect(entryMatchesSource(undefined, "human")).toBe(true);
    expect(entryMatchesSource("agent", "human")).toBe(false);
  });

  it("human + agent partition the entry set exactly (All = Human + Agent)", () => {
    const entries = [
      { kind: "user", min: 60 },
      { kind: "agent", min: 45 },
      { kind: "integration", min: 30 },
      { kind: "import", min: 15 },
      { kind: null, min: 5 },
      { kind: "agent", min: 10 },
    ];
    const sum = (source: ReportsSource): number =>
      entries
        .filter((e) => entryMatchesSource(e.kind, source))
        .reduce((s, e) => s + e.min, 0);
    expect(sum("all")).toBe(165);
    expect(sum("agent")).toBe(55);
    expect(sum("human")).toBe(110);
    expect(sum("human") + sum("agent")).toBe(sum("all"));
  });
});
