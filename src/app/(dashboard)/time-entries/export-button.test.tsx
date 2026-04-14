import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams("interval=week&anchor=2026-04-13&org=o1&groupBy=category"),
}));

import { ExportButton } from "./export-button";

describe("ExportButton", () => {
  it("renders a download link with all filter params", () => {
    renderWithIntl(<ExportButton />);
    const link = screen.getByRole("link", { name: /export/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("/api/time-entries/export?"));
    expect(link.getAttribute("href")).toContain("interval=week");
    expect(link.getAttribute("href")).toContain("anchor=2026-04-13");
    expect(link.getAttribute("href")).toContain("org=o1");
    expect(link.getAttribute("href")).toContain("groupBy=category");
    expect(link).toHaveAttribute("download");
  });
});
