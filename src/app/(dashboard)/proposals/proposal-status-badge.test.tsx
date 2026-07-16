import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { ProposalStatusBadge } from "./proposal-status-badge";

describe("ProposalStatusBadge", () => {
  it.each([
    ["draft", "Draft"],
    ["sent", "Sent"],
    ["viewed", "Viewed"],
    ["accepted", "Accepted"],
    ["declined", "Declined"],
    ["converted", "Converted"],
    ["superseded", "Superseded"],
  ])("renders %s with its translated label", (status, label) => {
    renderWithIntl(<ProposalStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("falls back to draft styling for unknown statuses", () => {
    renderWithIntl(<ProposalStatusBadge status="draft" />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("strikes through superseded (the 'no longer in force' channel)", () => {
    renderWithIntl(<ProposalStatusBadge status="superseded" />);
    expect(screen.getByText("Superseded").className).toContain("line-through");
  });

  it("prominent size exposes role=status for the detail header", () => {
    renderWithIntl(<ProposalStatusBadge status="accepted" size="prominent" />);
    expect(screen.getByRole("status")).toHaveTextContent("Accepted");
  });
});
