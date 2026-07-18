import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import type { RunningEntrySummary } from "@/hooks/use-running-entry";

/**
 * SidebarTimer — the module-owned running-timer widget composed into
 * the shell sidebar via the `timerSlot` prop. Behavior under test:
 *
 *   - stopped: quiet /time-entries invitation with the Space kbd hint
 *   - running: elapsed clock (baseline + live), project / customer
 *     line, author chip, entry deep-link, and a working Stop button
 */

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const stopTimerMock = vi.fn<(fd: FormData) => Promise<{ success: boolean }>>(
  async () => ({ success: true }),
);
vi.mock("./actions", () => ({
  stopTimerAction: (fd: FormData): Promise<{ success: boolean }> =>
    stopTimerMock(fd),
}));

// The hook owns the Supabase fetch; stub it and steer per-test via
// this mutable holder.
const runningHolder: { current: RunningEntrySummary | null } = {
  current: null,
};
vi.mock("@/hooks/use-running-entry", () => ({
  useRunningEntry: () => ({
    running: runningHolder.current,
    refetch: vi.fn(),
  }),
}));

import SidebarTimer from "./sidebar-timer";

const author = {
  displayName: "Marcus",
  avatarUrl: null,
  userId: "u-1",
};

function runningEntry(
  overrides: Partial<RunningEntrySummary> = {},
): RunningEntrySummary {
  return {
    id: "e-1",
    project_id: "p-1",
    category_id: null,
    user_id: "u-1",
    description: "hacking",
    start_time: new Date(Date.now() - 90_000).toISOString(),
    project_name: "Alpha",
    customer_name: "Acme",
    started_by_kind: "user",
    agent_label: null,
    today_baseline_min: 0,
    ...overrides,
  };
}

describe("SidebarTimer — stopped", () => {
  beforeEach(() => {
    runningHolder.current = null;
    stopTimerMock.mockClear();
    refreshMock.mockClear();
  });

  it("renders the quiet invitation linking to /time-entries with the Space hint", () => {
    renderWithIntl(<SidebarTimer {...author} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/time-entries");
    expect(screen.getByText("Space")).toBeInTheDocument();
  });

  it("does not render a Stop button or a running clock", () => {
    renderWithIntl(<SidebarTimer {...author} />);
    expect(
      screen.queryByRole("button", { name: /stop/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d{2}:\d{2}:\d{2}$/)).toBeNull();
  });
});

describe("SidebarTimer — running", () => {
  beforeEach(() => {
    runningHolder.current = runningEntry();
    stopTimerMock.mockClear();
    refreshMock.mockClear();
  });

  it("shows the elapsed clock, project and customer", () => {
    renderWithIntl(<SidebarTimer {...author} />);
    // 90s elapsed, zero baseline → 00:01:30 (allow a tick of slack).
    expect(screen.getByText(/^00:01:(29|30|31)$/)).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText(/Acme/)).toBeInTheDocument();
    expect(screen.getByText("hacking")).toBeInTheDocument();
  });

  it("adds today's baseline minutes on top of the live session", () => {
    runningHolder.current = runningEntry({ today_baseline_min: 60 });
    renderWithIntl(<SidebarTimer {...author} />);
    // 60 min baseline + ~90s live → 01:01:30-ish.
    expect(screen.getByText(/^01:01:(29|30|31)$/)).toBeInTheDocument();
  });

  it("renders the author chip and a deep link to the running entry", () => {
    renderWithIntl(<SidebarTimer {...author} />);
    expect(screen.getByText("Marcus")).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    const deepLink = links.find((l) =>
      l.getAttribute("href")?.includes("#entry-e-1"),
    );
    expect(deepLink).toBeDefined();
    expect(deepLink?.getAttribute("href")).toContain("/time-entries?view=day");
  });

  it("Stop button submits the entry id to stopTimerAction and refreshes", async () => {
    renderWithIntl(<SidebarTimer {...author} />);
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    await waitFor(() => expect(stopTimerMock).toHaveBeenCalledTimes(1));
    const fd = stopTimerMock.mock.calls[0]?.[0];
    expect(fd?.get("id")).toBe("e-1");
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("Space stops the timer when focus is on non-interactive content", async () => {
    renderWithIntl(<SidebarTimer {...author} />);
    fireEvent.keyDown(document.body, { code: "Space" });
    await waitFor(() => expect(stopTimerMock).toHaveBeenCalledTimes(1));
  });

  it("Space does NOT stop the timer while a text input is focused", () => {
    renderWithIntl(<SidebarTimer {...author} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { code: "Space" });
    expect(stopTimerMock).not.toHaveBeenCalled();
    input.remove();
  });
});

describe("SidebarTimer — agent-started running entry (SAL-051)", () => {
  beforeEach(() => {
    runningHolder.current = runningEntry({
      started_by_kind: "agent",
      agent_label: "Claude Code",
    });
    stopTimerMock.mockClear();
    refreshMock.mockClear();
  });

  it("shows the Bot badge + agent label so a runaway agent timer is visible at a glance", () => {
    const { container } = renderWithIntl(<SidebarTimer {...author} />);
    expect(screen.getByText("via Claude Code")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-bot")).not.toBeNull();
    // The human stays the author.
    expect(screen.getByText("Marcus")).toBeInTheDocument();
  });

  it("keeps Stop working exactly as for a user-started timer (read-only signal)", async () => {
    renderWithIntl(<SidebarTimer {...author} />);
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    await waitFor(() => expect(stopTimerMock).toHaveBeenCalledTimes(1));
    expect(stopTimerMock.mock.calls[0]?.[0]?.get("id")).toBe("e-1");
  });

  it("renders NO badge for a user-started timer", () => {
    runningHolder.current = runningEntry();
    const { container } = renderWithIntl(<SidebarTimer {...author} />);
    expect(container.querySelector("svg.lucide-bot")).toBeNull();
    expect(screen.queryByText(/via /)).toBeNull();
  });
});
