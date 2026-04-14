import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/time-entries",
  useSearchParams: () => new URLSearchParams("org=o1"),
}));

import { GroupByPicker } from "./group-by-picker";

describe("GroupByPicker", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("shows the current grouping label", () => {
    renderWithIntl(<GroupByPicker grouping="category" />);
    expect(screen.getByRole("button")).toHaveTextContent(/category/i);
  });

  it("opens the menu and picks Project → sets groupBy param", () => {
    renderWithIntl(<GroupByPicker grouping="day" />);
    fireEvent.click(screen.getByRole("button"));
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /project/i }));
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringMatching(/groupBy=project/),
    );
  });

  it("picking Day removes the groupBy param (default)", () => {
    renderWithIntl(<GroupByPicker grouping="category" />);
    fireEvent.click(screen.getByRole("button"));
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /day/i }));
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).not.toMatch(/groupBy/);
    // org param should be preserved
    expect(call).toMatch(/org=o1/);
  });

  it("closes on Escape", () => {
    renderWithIntl(<GroupByPicker grouping="day" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
