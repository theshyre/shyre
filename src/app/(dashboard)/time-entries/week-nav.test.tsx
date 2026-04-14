import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/time-entries",
  useSearchParams: () => new URLSearchParams(),
}));

import { WeekNav } from "./week-nav";

describe("WeekNav", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("navigates to the previous week", () => {
    renderWithIntl(<WeekNav weekStart={new Date(2026, 3, 13)} />);
    fireEvent.click(screen.getByRole("button", { name: /prev/i }));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("week=2026-04-06"));
  });

  it("navigates to the next week", () => {
    renderWithIntl(<WeekNav weekStart={new Date(2026, 3, 13)} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("week=2026-04-20"));
  });

  it("'This week' button navigates to current week", () => {
    renderWithIntl(<WeekNav weekStart={new Date(2026, 3, 13)} />);
    fireEvent.click(screen.getByRole("button", { name: /this week/i }));
    expect(pushMock).toHaveBeenCalled();
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).toMatch(/week=\d{4}-\d{2}-\d{2}/);
  });

  it("keyboard ArrowLeft triggers prev", () => {
    renderWithIntl(<WeekNav weekStart={new Date(2026, 3, 13)} />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("week=2026-04-06"));
  });

  it("keyboard ArrowRight triggers next", () => {
    renderWithIntl(<WeekNav weekStart={new Date(2026, 3, 13)} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("week=2026-04-20"));
  });

  it("date picker reflects current week", () => {
    renderWithIntl(<WeekNav weekStart={new Date(2026, 3, 13)} />);
    const datePicker = screen.getByLabelText(/week date picker/i) as HTMLInputElement;
    expect(datePicker.value).toBe("2026-04-13");
  });
});
