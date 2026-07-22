import { describe, it, expect } from "vitest";
import { agentHeartbeat, HEARTBEAT_STALE_HOURS } from "./agent-heartbeat";

const NOW = Date.parse("2026-07-22T12:00:00Z");
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("agentHeartbeat", () => {
  it("returns 'none' (info) when there is no agent entry", () => {
    expect(agentHeartbeat(null, NOW)).toEqual({
      state: "none",
      tone: "info",
      unit: null,
      value: 0,
    });
  });

  it("returns 'none' for an unparseable timestamp (never throws)", () => {
    expect(agentHeartbeat("not-a-date", NOW).state).toBe("none");
  });

  it("reports minutes for a recent entry (active/success)", () => {
    expect(agentHeartbeat(ago(6 * MIN), NOW)).toEqual({
      state: "active",
      tone: "success",
      unit: "minutes",
      value: 6,
    });
  });

  it("reports hours between 1h and 24h", () => {
    const s = agentHeartbeat(ago(5 * HOUR), NOW);
    expect(s).toMatchObject({ state: "active", unit: "hours", value: 5 });
  });

  it("reports days past 24h and stays active before the stale threshold", () => {
    // 2 days < 72h stale threshold
    const s = agentHeartbeat(ago(2 * DAY), NOW);
    expect(s).toMatchObject({ state: "active", tone: "success", unit: "days", value: 2 });
  });

  it("flips to 'stale' (warning) at the stale threshold", () => {
    const s = agentHeartbeat(ago(HEARTBEAT_STALE_HOURS * HOUR), NOW);
    expect(s).toMatchObject({ state: "stale", tone: "warning", unit: "days", value: 3 });
  });

  it("clamps a future timestamp to 0 (clock skew) rather than going negative", () => {
    expect(agentHeartbeat(new Date(NOW + 5 * MIN).toISOString(), NOW)).toMatchObject({
      state: "active",
      unit: "minutes",
      value: 0,
    });
  });
});
