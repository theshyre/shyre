import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/intl";
import { ReportsPeriodFilter } from "./reports-period-filter";

const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

const baseProps = {
  from: "2026-07-01",
  to: "2026-07-18",
  preset: "this_month" as const,
};

describe("ReportsPeriodFilter", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockSearchParams = new URLSearchParams();
  });

  it("renders a labelled group with every preset as a toggle button, active one pressed", () => {
    renderWithIntl(<ReportsPeriodFilter {...baseProps} />);
    expect(
      screen.getByRole("group", { name: /date range presets/i }),
    ).toBeInTheDocument();
    // Dynamic i18n keys: a drifted locale key would render the raw
    // key path instead of these labels.
    for (const label of [
      "This Month",
      "Last Month",
      "This Quarter",
      "Last Quarter",
      "This Year",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(
      screen.getByRole("button", { name: "This Month" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Last Month" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("pushes the preset and clears explicit from/to when a preset is clicked", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams(
      "preset=custom&from=2026-01-01&to=2026-01-31&org=t1",
    );
    renderWithIntl(<ReportsPeriodFilter {...baseProps} preset="custom" />);
    await user.click(screen.getByRole("button", { name: "Last Quarter" }));
    expect(mockPush).toHaveBeenCalledWith("?preset=last_quarter&org=t1");
  });

  it("applies a custom range as preset=custom with both bounds", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ReportsPeriodFilter {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(mockPush).toHaveBeenCalledWith(
      "?preset=custom&from=2026-07-01&to=2026-07-18",
    );
  });

  it("disables Apply when the range is inverted (from after to)", () => {
    renderWithIntl(
      <ReportsPeriodFilter
        {...baseProps}
        from="2026-07-18"
        to="2026-07-01"
      />,
    );
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("disables Apply when a bound is missing", () => {
    renderWithIntl(<ReportsPeriodFilter {...baseProps} from="" />);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });
});
