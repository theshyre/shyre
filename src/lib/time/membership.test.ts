import { describe, it, expect, vi } from "vitest";
import { selfScopedFloor } from "./membership";

interface MockClient {
  from: ReturnType<typeof vi.fn>;
}

function makeClient(joinedAt: string | null): MockClient {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: joinedAt === null ? null : { joined_at: joinedAt },
      error: null,
    }),
  };
  return { from: vi.fn(() => builder) };
}

const CALLER = "caller-id";
const TEAM = "team-id";
const WINDOW_START = new Date("2026-04-01T00:00:00.000Z");

describe("selfScopedFloor", () => {
  it("returns windowStart unchanged when no team is selected", async () => {
    const client = makeClient("2026-03-01T00:00:00.000Z");
    const floor = await selfScopedFloor(
      client as never,
      CALLER,
      null,
      [CALLER],
      WINDOW_START,
    );
    expect(floor).toEqual(WINDOW_START);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns windowStart unchanged when memberFilter is null (no self-scope)", async () => {
    const client = makeClient("2026-03-01T00:00:00.000Z");
    const floor = await selfScopedFloor(
      client as never,
      CALLER,
      TEAM,
      null,
      WINDOW_START,
    );
    expect(floor).toEqual(WINDOW_START);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns windowStart unchanged when memberFilter is multi-user", async () => {
    const client = makeClient("2026-03-01T00:00:00.000Z");
    const floor = await selfScopedFloor(
      client as never,
      CALLER,
      TEAM,
      [CALLER, "other-user"],
      WINDOW_START,
    );
    expect(floor).toEqual(WINDOW_START);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns windowStart unchanged when memberFilter is someone else", async () => {
    const client = makeClient("2026-03-01T00:00:00.000Z");
    const floor = await selfScopedFloor(
      client as never,
      CALLER,
      TEAM,
      ["other-user"],
      WINDOW_START,
    );
    expect(floor).toEqual(WINDOW_START);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns windowStart when joined_at is earlier than windowStart", async () => {
    // User joined long before the visible window — clamp doesn't activate.
    const client = makeClient("2025-01-15T00:00:00.000Z");
    const floor = await selfScopedFloor(
      client as never,
      CALLER,
      TEAM,
      [CALLER],
      WINDOW_START,
    );
    expect(floor).toEqual(WINDOW_START);
  });

  it("returns joined_at when later than windowStart (the gate activates)", async () => {
    // User joined inside the visible window — entries before joined_at
    // would be hidden by the clamp.
    const joined = "2026-04-15T00:00:00.000Z";
    const client = makeClient(joined);
    const floor = await selfScopedFloor(
      client as never,
      CALLER,
      TEAM,
      [CALLER],
      WINDOW_START,
    );
    expect(floor).toEqual(new Date(joined));
  });

  it("returns windowStart unchanged when no membership row exists (defensive)", async () => {
    const client = makeClient(null);
    const floor = await selfScopedFloor(
      client as never,
      CALLER,
      TEAM,
      [CALLER],
      WINDOW_START,
    );
    expect(floor).toEqual(WINDOW_START);
  });
});
