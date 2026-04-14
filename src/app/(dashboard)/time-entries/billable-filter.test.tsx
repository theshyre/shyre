import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/time-entries",
  useSearchParams: () => new URLSearchParams("org=o1"),
}));

import { BillableFilter } from "./billable-filter";

describe("BillableFilter", () => {
  beforeEach(() => pushMock.mockClear());

  it("shows 'All entries' label when inactive", () => {
    renderWithIntl(<BillableFilter active={false} />);
    expect(screen.getByRole("button", { name: /all entries/i })).toBeInTheDocument();
  });

  it("shows 'Billable only' label when active", () => {
    renderWithIntl(<BillableFilter active={true} />);
    expect(screen.getByRole("button", { name: /billable only/i })).toBeInTheDocument();
  });

  it("adds billable=1 to URL when toggling on", () => {
    renderWithIntl(<BillableFilter active={false} />);
    fireEvent.click(screen.getByRole("button"));
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).toMatch(/billable=1/);
    expect(call).toMatch(/org=o1/);
  });

  it("removes billable param when toggling off", () => {
    renderWithIntl(<BillableFilter active={true} />);
    fireEvent.click(screen.getByRole("button"));
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).not.toMatch(/billable/);
    expect(call).toMatch(/org=o1/);
  });

  it("sets aria-pressed", () => {
    renderWithIntl(<BillableFilter active={true} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });
});
