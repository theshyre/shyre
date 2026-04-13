import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcut } from "./use-keyboard-shortcut";

function fireKey(
  key: string,
  options?: { metaKey?: boolean; target?: HTMLElement }
): void {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: options?.metaKey ?? false,
    ctrlKey: false,
    bubbles: true,
  });
  if (options?.target) {
    Object.defineProperty(event, "target", { value: options.target });
  }
  window.dispatchEvent(event);
}

describe("useKeyboardShortcut", () => {
  it("fires callback on matching key press", () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcut({ key: "n", onTrigger: handler })
    );

    fireKey("n");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire on non-matching key", () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcut({ key: "n", onTrigger: handler })
    );

    fireKey("m");
    expect(handler).not.toHaveBeenCalled();
  });

  it("fires Cmd combo regardless of input focus", () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcut({ key: "s", meta: true, onTrigger: handler })
    );

    fireKey("s", { metaKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire without meta when meta is required", () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcut({ key: "s", meta: true, onTrigger: handler })
    );

    fireKey("s");
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not fire when input is focused (non-meta)", () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcut({ key: "n", onTrigger: handler })
    );

    const input = document.createElement("input");
    fireKey("n", { target: input });
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not fire when disabled", () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcut({ key: "n", onTrigger: handler, enabled: false })
    );

    fireKey("n");
    expect(handler).not.toHaveBeenCalled();
  });

  it("is case-insensitive", () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcut({ key: "n", onTrigger: handler })
    );

    fireKey("N");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
