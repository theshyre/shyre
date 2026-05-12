import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("next/navigation", () => ({
  usePathname: () => "/customers",
  useSearchParams: () => ({
    toString: () => "status=active",
  }),
}));

vi.mock("@/components/LinkPendingSpinner", () => ({
  LinkPendingSpinner: () => null,
}));

import { PaginationFooter } from "./PaginationFooter";

describe("PaginationFooter", () => {
  it("renders nothing when everything is loaded", () => {
    const { container } = renderWithIntl(
      <PaginationFooter total={50} loaded={50} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the 'load N more' button when more rows exist", () => {
    renderWithIntl(<PaginationFooter total={200} loaded={50} step={50} />);
    expect(screen.getByText(/Load 50 more/)).toBeInTheDocument();
  });

  it("shows the 'load all N' link only when remaining > step", () => {
    renderWithIntl(<PaginationFooter total={200} loaded={50} step={50} />);
    // 200 - 50 = 150 remaining, > step 50 → 'Load all 150' visible.
    expect(screen.getByText(/Load all 150/)).toBeInTheDocument();
  });

  it("hides the 'load all' link when remaining <= step (load-more does the same job)", () => {
    renderWithIntl(<PaginationFooter total={75} loaded={50} step={50} />);
    // 25 remaining, < step → no 'load all' link.
    expect(screen.queryByText(/Load all/)).toBeNull();
    // But 'load 25 more' shows (clamped to remaining).
    expect(screen.getByText(/Load 25 more/)).toBeInTheDocument();
  });

  it("builds the URL with the new limit + preserved existing params", () => {
    renderWithIntl(<PaginationFooter total={200} loaded={50} step={50} />);
    const more = screen.getByText(/Load 50 more/).closest("a");
    const href = more?.getAttribute("href") ?? "";
    expect(href).toContain("/customers?");
    expect(href).toContain("status=active");
    expect(href).toContain("limit=100");
  });

  it("shows the 'X of N' caption with the current loaded count", () => {
    renderWithIntl(<PaginationFooter total={200} loaded={50} />);
    expect(screen.getByText(/Showing\s+50\s+of\s+200/)).toBeInTheDocument();
  });

  it("uses default step of 50 when omitted", () => {
    renderWithIntl(<PaginationFooter total={500} loaded={50} />);
    expect(screen.getByText(/Load 50 more/)).toBeInTheDocument();
  });

  it("clamps the next step to remaining when remaining < step", () => {
    renderWithIntl(<PaginationFooter total={62} loaded={50} step={50} />);
    // 12 remaining; load N more clamps to 12.
    expect(screen.getByText(/Load 12 more/)).toBeInTheDocument();
  });
});
