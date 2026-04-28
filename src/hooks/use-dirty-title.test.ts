import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDirtyTitle } from "./use-dirty-title";

const ORIGINAL_TITLE = "Invoices · Shyre";

beforeEach(() => {
  document.title = ORIGINAL_TITLE;
});

afterEach(() => {
  document.title = ORIGINAL_TITLE;
});

describe("useDirtyTitle", () => {
  it("does nothing when dirty=false", () => {
    renderHook(() => useDirtyTitle(false));
    expect(document.title).toBe(ORIGINAL_TITLE);
  });

  it("prepends '• ' when dirty=true", () => {
    renderHook(() => useDirtyTitle(true));
    expect(document.title).toBe(`• ${ORIGINAL_TITLE}`);
  });

  it("strips '• ' on cleanup (component unmount)", () => {
    const { unmount } = renderHook(() => useDirtyTitle(true));
    expect(document.title).toBe(`• ${ORIGINAL_TITLE}`);
    unmount();
    expect(document.title).toBe(ORIGINAL_TITLE);
  });

  it("strips '• ' when dirty flips back to false", () => {
    const { rerender } = renderHook(
      ({ dirty }: { dirty: boolean }) => useDirtyTitle(dirty),
      { initialProps: { dirty: true } },
    );
    expect(document.title).toBe(`• ${ORIGINAL_TITLE}`);
    rerender({ dirty: false });
    expect(document.title).toBe(ORIGINAL_TITLE);
  });

  it("does not double-bullet when invoked twice with dirty=true", () => {
    const { rerender } = renderHook(
      ({ dirty }: { dirty: boolean }) => useDirtyTitle(dirty),
      { initialProps: { dirty: true } },
    );
    rerender({ dirty: true });
    expect(document.title).toBe(`• ${ORIGINAL_TITLE}`);
    expect(document.title.startsWith("• • ")).toBe(false);
  });

  it("re-prepends '• ' if external code overwrites the title while dirty", async () => {
    renderHook(() => useDirtyTitle(true));
    expect(document.title).toBe(`• ${ORIGINAL_TITLE}`);

    // Simulate Next.js metadata replacing the title mid-route.
    document.title = "Different page · Shyre";

    // The MutationObserver fires asynchronously — give the
    // microtask queue a tick. In jsdom this is a setTimeout(0).
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(document.title).toBe("• Different page · Shyre");
  });
});
