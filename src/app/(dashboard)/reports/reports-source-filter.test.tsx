import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/intl";
import { ReportsSourceFilter } from "./reports-source-filter";

const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

describe("ReportsSourceFilter", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockSearchParams = new URLSearchParams();
  });

  it("renders a labelled group of three toggle buttons with the active one pressed", () => {
    renderWithIntl(<ReportsSourceFilter source="all" />);
    expect(screen.getByRole("group", { name: /source/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /all sources/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /human/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /agent/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("pushes ?source=agent when Agent is clicked", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ReportsSourceFilter source="all" />);
    await user.click(screen.getByRole("button", { name: /agent/i }));
    expect(mockPush).toHaveBeenCalledWith("?source=agent");
  });

  it("pushes ?source=human when Human is clicked", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ReportsSourceFilter source="all" />);
    await user.click(screen.getByRole("button", { name: /human/i }));
    expect(mockPush).toHaveBeenCalledWith("?source=human");
  });

  it("drops the source param entirely when All is clicked (clean URLs)", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams("source=agent&preset=this_month");
    renderWithIntl(<ReportsSourceFilter source="agent" />);
    await user.click(screen.getByRole("button", { name: /all sources/i }));
    expect(mockPush).toHaveBeenCalledWith("?preset=this_month");
  });

  it("preserves unrelated params (period, org) when switching source", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams("preset=last_month&org=t1");
    renderWithIntl(<ReportsSourceFilter source="all" />);
    await user.click(screen.getByRole("button", { name: /agent/i }));
    expect(mockPush).toHaveBeenCalledWith(
      "?preset=last_month&org=t1&source=agent",
    );
  });
});
