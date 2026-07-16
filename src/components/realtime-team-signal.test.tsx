import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals?.count != null ? `${key}:${String(vals.count)}` : key,
}));

// Shared, test-controllable fake for the browser Supabase client. `vi.hoisted`
// so it exists before the hoisted `vi.mock` factory runs.
const h = vi.hoisted(() => ({
  broadcastHandlers: [] as Array<() => void>,
  channelNames: [] as string[],
  subscribeMock: vi.fn(),
  removeChannelMock: vi.fn(),
  removeAllMock: vi.fn(),
  setAuthMock: vi.fn(),
  unsubscribeMock: vi.fn(),
  authCb: { current: null as null | ((event: string) => void) },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (name: string) => {
      h.channelNames.push(name);
      const channel: {
        on: (t: string, f: unknown, cb: () => void) => typeof channel;
        subscribe: () => typeof channel;
      } = {
        on: (_type, _filter, cb) => {
          h.broadcastHandlers.push(cb);
          return channel;
        },
        subscribe: () => {
          h.subscribeMock();
          return channel;
        },
      };
      return channel;
    },
    removeChannel: (c: unknown) => h.removeChannelMock(c),
    removeAllChannels: () => h.removeAllMock(),
    realtime: { setAuth: () => h.setAuthMock() },
    auth: {
      onAuthStateChange: (cb: (event: string) => void) => {
        h.authCb.current = cb;
        return { data: { subscription: { unsubscribe: h.unsubscribeMock } } };
      },
    },
  }),
}));

import { RealtimeTeamSignal } from "./realtime-team-signal";

/** Fire one Broadcast signal into every subscribed channel handler. */
function emitSignal(): void {
  act(() => {
    for (const handler of h.broadcastHandlers) handler();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  h.broadcastHandlers.length = 0;
  h.channelNames.length = 0;
  h.authCb.current = null;
  refreshMock.mockReset();
  h.subscribeMock.mockReset();
  h.removeChannelMock.mockReset();
  h.setAuthMock.mockReset();
  h.unsubscribeMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RealtimeTeamSignal", () => {
  it("subscribes one private channel per team and authenticates the socket", () => {
    render(<RealtimeTeamSignal teamIds={["t1", "t2"]} />);
    expect(h.channelNames).toEqual(["team:t1", "team:t2"]);
    expect(h.subscribeMock).toHaveBeenCalledTimes(2);
    expect(h.setAuthMock).toHaveBeenCalled();
    // Nothing shown until a change arrives.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing and opens no channel when the user has no teams", () => {
    render(<RealtimeTeamSignal teamIds={[]} />);
    expect(h.channelNames).toEqual([]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("surfaces the refresh pill when a change is broadcast", () => {
    render(<RealtimeTeamSignal teamIds={["t1"]} />);
    emitSignal();
    expect(screen.getByRole("button").textContent).toContain(
      "freshness.updatesAvailable:1",
    );
  });

  it("coalesces a burst of signals into a single increment", () => {
    render(<RealtimeTeamSignal teamIds={["t1"]} />);
    emitSignal();
    emitSignal();
    emitSignal();
    expect(screen.getByRole("button").textContent).toContain(
      "freshness.updatesAvailable:1",
    );
    // After the coalescing window, a fresh change counts again.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    emitSignal();
    expect(screen.getByRole("button").textContent).toContain(
      "freshness.updatesAvailable:2",
    );
  });

  it("refreshes and dismisses the pill when clicked", () => {
    render(<RealtimeTeamSignal teamIds={["t1"]} />);
    emitSignal();
    fireEvent.click(screen.getByRole("button"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("re-authenticates the socket on token refresh", () => {
    render(<RealtimeTeamSignal teamIds={["t1"]} />);
    h.setAuthMock.mockClear();
    act(() => {
      h.authCb.current?.("TOKEN_REFRESHED");
    });
    expect(h.setAuthMock).toHaveBeenCalledTimes(1);
  });

  it("removes channels and unsubscribes auth on unmount", () => {
    const { unmount } = render(<RealtimeTeamSignal teamIds={["t1", "t2"]} />);
    unmount();
    expect(h.removeChannelMock).toHaveBeenCalledTimes(2);
    expect(h.unsubscribeMock).toHaveBeenCalledTimes(1);
  });
});
