import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/proposals",
  useSearchParams: () => mockSearchParams,
}));

import { ProposalStatusFilterChip } from "./proposals-filters";

describe("ProposalStatusFilterChip", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockSearchParams = new URLSearchParams();
  });

  it("shows the selected bucket label on the chip", () => {
    renderWithIntl(<ProposalStatusFilterChip selected="sent" />);
    expect(
      screen.getByRole("button", { name: /Sent & viewed/ }),
    ).toBeInTheDocument();
  });

  it("lists every bucket in the dropdown", () => {
    renderWithIntl(<ProposalStatusFilterChip selected="all" />);
    fireEvent.click(screen.getByRole("button", { name: /All statuses/ }));
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "All statuses",
      "Draft",
      "Sent & viewed",
      "Accepted",
      "Declined",
      "History",
    ]);
    expect(
      screen.getByRole("option", { name: /All statuses/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("pushes ?status= for a named bucket and drops any stale limit", () => {
    mockSearchParams = new URLSearchParams("org=t1&limit=150");
    renderWithIntl(<ProposalStatusFilterChip selected="all" />);
    fireEvent.click(screen.getByRole("button", { name: /All statuses/ }));
    fireEvent.click(screen.getByRole("option", { name: /History/ }));
    expect(mockPush).toHaveBeenCalledWith("/proposals?org=t1&status=history");
  });

  it("strips ?status= when picking All (the default)", () => {
    mockSearchParams = new URLSearchParams("status=draft");
    renderWithIntl(<ProposalStatusFilterChip selected="draft" />);
    fireEvent.click(screen.getByRole("button", { name: /Draft/ }));
    fireEvent.click(screen.getByRole("option", { name: /All statuses/ }));
    expect(mockPush).toHaveBeenCalledWith("/proposals?");
  });
});
