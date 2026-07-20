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

  it.each([["sent"], ["viewed"]])(
    "relabels an expired %s proposal as Expired",
    (status) => {
      renderWithIntl(<ProposalStatusBadge status={status} expired />);
      expect(screen.getByText("Expired")).toBeInTheDocument();
      expect(screen.queryByText("Sent")).not.toBeInTheDocument();
      expect(screen.queryByText("Viewed")).not.toBeInTheDocument();
    },
  );

  it("ignores the expired flag on decided statuses", () => {
    renderWithIntl(<ProposalStatusBadge status="accepted" expired />);
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.queryByText("Expired")).not.toBeInTheDocument();
  });

  it("renders 'N of M signed' for a partially-signed in-flight proposal", () => {
    renderWithIntl(
      <ProposalStatusBadge status="viewed" signoff={{ signed: 1, total: 2 }} />,
    );
    expect(screen.getByText("1 of 2 signed")).toBeInTheDocument();
    expect(screen.queryByText("Viewed")).not.toBeInTheDocument();
  });

  it("prefers partial sign-off over the expired cue (more actionable)", () => {
    renderWithIntl(
      <ProposalStatusBadge
        status="viewed"
        expired
        signoff={{ signed: 1, total: 3 }}
      />,
    );
    expect(screen.getByText("1 of 3 signed")).toBeInTheDocument();
    expect(screen.queryByText("Expired")).not.toBeInTheDocument();
  });

  it("ignores a signoff projection on a decided status", () => {
    renderWithIntl(
      <ProposalStatusBadge
        status="accepted"
        signoff={{ signed: 1, total: 2 }}
      />,
    );
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.queryByText(/of 2 signed/)).not.toBeInTheDocument();
  });
});
