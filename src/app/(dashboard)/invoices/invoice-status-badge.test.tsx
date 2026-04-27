import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { InvoiceStatusBadge } from "./invoice-status-badge";

describe("InvoiceStatusBadge", () => {
  it("renders the i18n status label for each known status", () => {
    const cases = ["draft", "sent", "paid", "overdue", "void"] as const;
    for (const s of cases) {
      const { unmount } = renderWithIntl(<InvoiceStatusBadge status={s} />);
      // The status label is rendered as visible text; the icon is
      // aria-hidden so the SR reads exactly the label.
      expect(screen.getByText(new RegExp(s, "i"))).toBeInTheDocument();
      unmount();
    }
  });

  it("falls back gracefully on an unknown status", () => {
    // Unknown statuses use the draft styling (and the t() lookup
    // returns the key path itself if missing) — the component must
    // not throw.
    const { container } = renderWithIntl(
      <InvoiceStatusBadge status="not-a-real-status" />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("iconOnly mode wraps in a Tooltip and exposes the label via aria-label", () => {
    renderWithIntl(<InvoiceStatusBadge status="paid" iconOnly />);
    // Two channels of accessibility: aria-label on the wrapper, and
    // the Tooltip rendering the label on hover/focus.
    const labelled = screen.getAllByLabelText(/paid/i);
    expect(labelled.length).toBeGreaterThan(0);
  });

  it("renders an icon in default mode (color + text + icon = 3 channels)", () => {
    const { container } = renderWithIntl(
      <InvoiceStatusBadge status="paid" />,
    );
    // Lucide renders <svg>; presence of a child SVG is the redundant-
    // encoding sentinel that the agent reviews flagged was missing.
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
