import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAutosaveStatus } from "./useAutosaveStatus";

describe("useAutosaveStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts idle with no lastSavedAt", () => {
    const { result } = renderHook(() => useAutosaveStatus());
    expect(result.current.status).toBe("idle");
    expect(result.current.lastSavedAt).toBeNull();
    expect(result.current.lastError).toBeNull();
  });

  it("transitions idle → saving → saved on success", async () => {
    const { result } = renderHook(() => useAutosaveStatus());
    let resolve: (v: unknown) => void = () => {};
    const p = new Promise((r) => {
      resolve = r;
    });

    let wrapped: Promise<unknown>;
    act(() => {
      wrapped = result.current.wrap(p);
    });
    expect(result.current.status).toBe("saving");

    act(() => resolve("ok"));
    await act(async () => {
      await wrapped!;
    });
    expect(result.current.status).toBe("saved");
    expect(result.current.lastSavedAt).toBeTypeOf("number");
  });

  it("transitions to error on rejection and captures message", async () => {
    const { result } = renderHook(() => useAutosaveStatus());
    await act(async () => {
      await result.current
        .wrap(Promise.reject(new Error("boom")))
        .catch(() => {
          /* swallow for assertion */
        });
    });
    expect(result.current.status).toBe("error");
    expect(result.current.lastError).toBe("boom");
  });

  it("concurrent saves coalesce — status stays saving until all resolve", async () => {
    const { result } = renderHook(() => useAutosaveStatus());
    let resolveA: (v: unknown) => void = () => {};
    let resolveB: (v: unknown) => void = () => {};
    const a = new Promise((r) => {
      resolveA = r;
    });
    const b = new Promise((r) => {
      resolveB = r;
    });

    let pa: Promise<unknown>;
    let pb: Promise<unknown>;
    act(() => {
      pa = result.current.wrap(a);
      pb = result.current.wrap(b);
    });
    expect(result.current.status).toBe("saving");

    act(() => resolveA(1));
    await act(async () => {
      await pa!;
    });
    // one still inflight — status must not flip to saved yet
    expect(result.current.status).toBe("saving");

    act(() => resolveB(2));
    await act(async () => {
      await pb!;
    });
    expect(result.current.status).toBe("saved");
  });

  it("reset() clears error state", async () => {
    const { result } = renderHook(() => useAutosaveStatus());
    await act(async () => {
      await result.current.wrap(Promise.reject(new Error("x"))).catch(() => {});
    });
    expect(result.current.status).toBe("error");
    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
    expect(result.current.lastError).toBeNull();
  });

  it("wrap rethrows so callers can respond", async () => {
    const { result } = renderHook(() => useAutosaveStatus());
    await expect(
      act(async () => {
        await result.current.wrap(Promise.reject(new Error("nope")));
      }),
    ).rejects.toThrow("nope");
  });

  it("waitFor: saved status surfaces lastSavedAt close to Date.now()", async () => {
    vi.useRealTimers();
    const { result } = renderHook(() => useAutosaveStatus());
    const before = Date.now();
    await act(async () => {
      await result.current.wrap(Promise.resolve("ok"));
    });
    await waitFor(() => {
      expect(result.current.status).toBe("saved");
    });
    expect(result.current.lastSavedAt).toBeGreaterThanOrEqual(before);
  });
});
