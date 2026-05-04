import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUnsavedChanges } from "./use-unsaved-changes";

describe("useUnsavedChanges", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches a beforeunload listener when dirty=true", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    renderHook(() => useUnsavedChanges(true));
    expect(addSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("does not attach when dirty=false", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    renderHook(() => useUnsavedChanges(false));
    expect(addSpy).not.toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("calls preventDefault on the event so the browser shows its prompt", () => {
    let captured: ((e: BeforeUnloadEvent) => void) | null = null;
    vi.spyOn(window, "addEventListener").mockImplementation(
      (type, handler) => {
        if (type === "beforeunload") {
          captured = handler as (e: BeforeUnloadEvent) => void;
        }
      },
    );
    renderHook(() => useUnsavedChanges(true));
    expect(captured).not.toBeNull();
    const event = {
      preventDefault: vi.fn(),
      returnValue: undefined,
    } as unknown as BeforeUnloadEvent;
    captured!(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue).toBe("");
  });

  it("removes the listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useUnsavedChanges(true));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("removes the listener when dirty flips back to false", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { rerender } = renderHook(
      ({ dirty }: { dirty: boolean }) => useUnsavedChanges(dirty),
      { initialProps: { dirty: true } },
    );
    rerender({ dirty: false });
    expect(removeSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });
});
