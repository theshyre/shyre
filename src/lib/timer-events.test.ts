import { describe, it, expect, vi, beforeEach } from "vitest";
import { TIMER_CHANGED_EVENT, notifyTimerChanged } from "./timer-events";

describe("timer-events", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes the documented event name string", () => {
    expect(TIMER_CHANGED_EVENT).toBe("shyre:timer:changed");
  });

  it("notifyTimerChanged dispatches a window event of that name", () => {
    const listener = vi.fn();
    window.addEventListener(TIMER_CHANGED_EVENT, listener);
    notifyTimerChanged();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]?.type).toBe(TIMER_CHANGED_EVENT);
    window.removeEventListener(TIMER_CHANGED_EVENT, listener);
  });

  it("is a no-op when window is undefined (SSR-safe)", () => {
    const originalWindow = global.window;
    // @ts-expect-error temporary cast for SSR simulation
    delete global.window;
    expect(() => notifyTimerChanged()).not.toThrow();
    global.window = originalWindow;
  });

  it("dispatches a fresh Event each call (not a reused reference)", () => {
    const events: Event[] = [];
    const listener = (e: Event): void => {
      events.push(e);
    };
    window.addEventListener(TIMER_CHANGED_EVENT, listener);
    notifyTimerChanged();
    notifyTimerChanged();
    notifyTimerChanged();
    expect(events).toHaveLength(3);
    // Each one is a distinct object instance.
    expect(events[0]).not.toBe(events[1]);
    expect(events[1]).not.toBe(events[2]);
    window.removeEventListener(TIMER_CHANGED_EVENT, listener);
  });
});
