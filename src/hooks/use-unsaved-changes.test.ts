import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUnsavedChanges } from "./use-unsaved-changes";

describe("useUnsavedChanges", () => {
  it("adds beforeunload listener when hasChanges is true", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    renderHook(() => useUnsavedChanges(true));
    expect(addSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function)
    );
    addSpy.mockRestore();
  });

  it("does not add listener when hasChanges is false", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const callsBefore = addSpy.mock.calls.length;
    renderHook(() => useUnsavedChanges(false));
    const beforeUnloadCalls = addSpy.mock.calls
      .slice(callsBefore)
      .filter(([event]) => event === "beforeunload");
    expect(beforeUnloadCalls).toHaveLength(0);
    addSpy.mockRestore();
  });

  it("removes listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useUnsavedChanges(true));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function)
    );
    removeSpy.mockRestore();
  });
});
