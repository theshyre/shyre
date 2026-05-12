import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("app/(dashboard)/not-found.tsx", () => {
  it("renders the notFound variant of ErrorDisplay without a Retry button", async () => {
    const { default: DashboardNotFound } = await import("./not-found");
    render(<DashboardNotFound />);
    expect(screen.getByText(/Page not found/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try Again/i })).toBeNull();
  });
});
