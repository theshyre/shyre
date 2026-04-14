import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/time-entries",
  useSearchParams: () => new URLSearchParams(),
}));

import { IntervalNav } from "./interval-nav";
import type { ResolvedInterval } from "@/lib/time/intervals";

const weekInterval: ResolvedInterval = {
  kind: "week",
  start: new Date(2026, 3, 13),
  end: new Date(2026, 3, 20),
};

describe("IntervalNav", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("renders the interval label", () => {
    renderWithIntl(<IntervalNav interval={weekInterval} />);
    // April 13 appears in the label
    expect(screen.getByRole("button", { name: /apr\s*13/i })).toBeInTheDocument();
  });

  it("prev navigates one week back", () => {
    renderWithIntl(<IntervalNav interval={weekInterval} />);
    fireEvent.click(screen.getByRole("button", { name: /previous/i }));
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining("anchor=2026-04-06"),
    );
  });

  it("next navigates one week forward", () => {
    renderWithIntl(<IntervalNav interval={weekInterval} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining("anchor=2026-04-20"),
    );
  });

  it("keyboard ArrowLeft triggers prev", () => {
    renderWithIntl(<IntervalNav interval={weekInterval} />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(pushMock).toHaveBeenCalled();
  });

  it("opens the interval-kind menu and switches to Month", () => {
    renderWithIntl(<IntervalNav interval={weekInterval} />);
    fireEvent.click(screen.getByRole("button", { name: /choose interval/i }));
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /month/i }));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("interval=month"));
  });

  it("shows custom date inputs when interval.kind is custom", () => {
    const custom: ResolvedInterval = {
      kind: "custom",
      start: new Date(2026, 3, 10),
      end: new Date(2026, 3, 21),
    };
    renderWithIntl(<IntervalNav interval={custom} />);
    expect(screen.getByLabelText(/start date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/end date/i)).toBeInTheDocument();
  });

  it("custom start-date change triggers navigation", () => {
    const custom: ResolvedInterval = {
      kind: "custom",
      start: new Date(2026, 3, 10),
      end: new Date(2026, 3, 21),
    };
    renderWithIntl(<IntervalNav interval={custom} />);
    const start = screen.getByLabelText(/start date/i) as HTMLInputElement;
    fireEvent.change(start, { target: { value: "2026-04-05" } });
    expect(pushMock).toHaveBeenCalled();
  });
});
