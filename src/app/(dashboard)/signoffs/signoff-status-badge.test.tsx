import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { SignoffStatusBadge } from "./signoff-status-badge";

describe("SignoffStatusBadge", () => {
  it.each([
    ["draft", "Draft"],
    ["sent", "Sent"],
    ["viewed", "Viewed"],
    ["completed", "Completed"],
    ["declined", "Declined"],
    ["superseded", "Superseded"],
    ["canceled", "Canceled"],
  ])("renders the %s label (text channel)", (status, label) => {
    const { unmount } = renderWithIntl(<SignoffStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    unmount();
  });

  it("line-throughs the no-longer-in-force states", () => {
    renderWithIntl(<SignoffStatusBadge status="superseded" />);
    expect(screen.getByText("Superseded").className).toContain("line-through");
  });

  it("renders the prominent size for the detail header", () => {
    renderWithIntl(<SignoffStatusBadge status="completed" size="prominent" />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });
});
