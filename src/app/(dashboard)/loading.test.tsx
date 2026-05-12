import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("app/(dashboard)/loading.tsx", () => {
  it("renders a status region with aria-busy=true for the route-loading skeleton", async () => {
    const { default: DashboardLoading } = await import("./loading");
    render(<DashboardLoading />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.getAttribute("aria-label")).toBe("Loading");
  });

  it("renders multiple skeleton blocks with animate-pulse", async () => {
    const { default: DashboardLoading } = await import("./loading");
    const { container } = render(<DashboardLoading />);
    const pulses = container.querySelectorAll(".animate-pulse");
    expect(pulses.length).toBeGreaterThanOrEqual(3);
  });
});
