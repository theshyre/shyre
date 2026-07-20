import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUnsavedChanges } from "./use-unsaved-changes";

/**
 * Previously untested despite being the sole guard behind CLAUDE.md's
 * "Unsaved changes guard" rule and (as of audit batch D) two new call
 * sites: team-settings-form.tsx and identity-form.tsx.
 */
describe("useUnsavedChanges", () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addSpy = vi.spyOn(window, "addEventListener");
    removeSpy = vi.spyOn(window, "removeEventListener");
  });

  afterEach(() => {
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("attaches a beforeunload listener when dirty is true", () => {
    renderHook(() => useUnsavedChanges(true));
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("does NOT attach a listener when dirty is false", () => {
    renderHook(() => useUnsavedChanges(false));
    expect(addSpy).not.toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("detaches the listener when dirty flips back to false", () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedChanges(dirty), {
      initialProps: { dirty: true },
    });
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    rerender({ dirty: false });
    expect(removeSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("detaches the listener on unmount", () => {
    const { unmount } = renderHook(() => useUnsavedChanges(true));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("the handler calls preventDefault and sets returnValue so the browser shows its native prompt", () => {
    renderHook(() => useUnsavedChanges(true));
    const call = addSpy.mock.calls.find(
      ([type]: [string, ...unknown[]]) => type === "beforeunload",
    );
    expect(call).toBeDefined();
    const handler = call![1] as (e: BeforeUnloadEvent) => void;
    const fakeEvent = {
      preventDefault: vi.fn(),
      returnValue: "",
    } as unknown as BeforeUnloadEvent;
    handler(fakeEvent);
    expect(fakeEvent.preventDefault).toHaveBeenCalled();
    expect(fakeEvent.returnValue).toBe("");
  });
});
