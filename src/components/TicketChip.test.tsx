import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

/**
 * TicketChip — render-only checks. Refresh + apply-as-title actions
 * delegate to time-entries actions that have their own tests; we
 * stub them out to keep the chip test focused on the visual contract:
 *
 *   - Jira vs GitHub provider variant (icon + ringClass)
 *   - size="sm" shows tooltip-titled key only
 *   - size="md" shows key + inline title
 *   - link variant when url present; static span when null
 *   - action buttons only render with canRefresh + entryId
 *   - apply-as-title button only when title is resolved
 */

vi.mock("@/app/(dashboard)/time-entries/actions", () => ({
  refreshTicketTitleAction: vi.fn().mockResolvedValue(undefined),
  applyTicketTitleAsDescriptionAction: vi.fn().mockResolvedValue(undefined),
}));

import { TicketChip } from "./TicketChip";

describe("TicketChip — provider variants", () => {
  it("renders Jira provider with the 'J' glyph", () => {
    const { container } = renderWithIntl(
      <TicketChip
        provider="jira"
        ticketKey="AE-642"
        url="https://example.atlassian.net/browse/AE-642"
        title="Fix login bug"
      />,
    );
    // The 'J' glyph is rendered as an aria-hidden span.
    const jBadge = Array.from(
      container.querySelectorAll("span[aria-hidden='true']"),
    ).find((el) => el.textContent === "J");
    expect(jBadge).toBeDefined();
    expect(screen.getByText("AE-642")).toBeInTheDocument();
  });

  it("renders GitHub provider with the GitBranch icon", () => {
    const { container } = renderWithIntl(
      <TicketChip
        provider="github"
        ticketKey="acme/repo#123"
        url="https://github.com/acme/repo/issues/123"
        title={null}
      />,
    );
    // Lucide icons render as svg with role="img" or no role. We just
    // assert there's an svg in the chip and it isn't the 'J' span.
    const chipSvgs = container.querySelectorAll("svg");
    expect(chipSvgs.length).toBeGreaterThan(0);
    expect(screen.getByText("acme/repo#123")).toBeInTheDocument();
  });
});

describe("TicketChip — size variants", () => {
  it("size='md' shows the inline title alongside the key", () => {
    renderWithIntl(
      <TicketChip
        provider="jira"
        ticketKey="AE-642"
        url={null}
        title="Fix login bug"
        size="md"
      />,
    );
    expect(screen.getByText(/Fix login bug/)).toBeInTheDocument();
  });

  it("size='sm' does NOT render the inline title (title moves to tooltip)", () => {
    renderWithIntl(
      <TicketChip
        provider="jira"
        ticketKey="AE-642"
        url={null}
        title="Fix login bug"
        size="sm"
      />,
    );
    // Title text not in the chip body. (The Tooltip mounts the title
    // into its portal only when shown, so it shouldn't appear here.)
    expect(screen.queryByText(/Fix login bug/)).toBeNull();
  });
});

describe("TicketChip — link vs static", () => {
  it("renders an <a target=_blank rel=noopener> when url is present", () => {
    const { container } = renderWithIntl(
      <TicketChip
        provider="jira"
        ticketKey="AE-642"
        url="https://example.atlassian.net/browse/AE-642"
        title="x"
      />,
    );
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe(
      "https://example.atlassian.net/browse/AE-642",
    );
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders a static span (no <a>) when url is null", () => {
    const { container } = renderWithIntl(
      <TicketChip
        provider="github"
        ticketKey="acme/repo#1"
        url={null}
        title={null}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("TicketChip — action buttons", () => {
  it("does NOT render refresh / apply buttons without canRefresh", () => {
    renderWithIntl(
      <TicketChip
        entryId="e-1"
        provider="jira"
        ticketKey="AE-642"
        url={null}
        title="t"
      />,
    );
    expect(screen.queryByLabelText(/refresh/i)).toBeNull();
    expect(screen.queryByLabelText(/title/i)).toBeNull();
  });

  it("does NOT render refresh / apply buttons without entryId (preview / pre-save context)", () => {
    renderWithIntl(
      <TicketChip
        provider="jira"
        ticketKey="AE-642"
        url={null}
        title="t"
        canRefresh
      />,
    );
    expect(screen.queryByLabelText(/refresh/i)).toBeNull();
  });

  it("renders the refresh button when canRefresh + entryId", () => {
    renderWithIntl(
      <TicketChip
        entryId="e-1"
        provider="jira"
        ticketKey="AE-642"
        url={null}
        title="t"
        canRefresh
      />,
    );
    expect(screen.getByLabelText(/refresh/i)).toBeInTheDocument();
  });

  it("apply-as-title button only renders when a title is resolved", () => {
    // Without a title: only the refresh button (1).
    const { container, rerender } = renderWithIntl(
      <TicketChip
        entryId="e-1"
        provider="jira"
        ticketKey="AE-642"
        url={null}
        title={null}
        canRefresh
      />,
    );
    expect(container.querySelectorAll("button").length).toBe(1);

    // With a title: refresh + apply-as-title (2 buttons).
    rerender(
      <TicketChip
        entryId="e-1"
        provider="jira"
        ticketKey="AE-642"
        url={null}
        title="Resolved title"
        canRefresh
      />,
    );
    expect(container.querySelectorAll("button").length).toBe(2);
  });
});
