import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

describe("app/(dashboard)/error.tsx", () => {
  it("renders ErrorDisplay with the digest and a working reset", async () => {
    const { default: DashboardError } = await import("./error");
    const reset = vi.fn();
    const err = Object.assign(new Error("dashboard boom"), {
      digest: "dash-1",
    });
    render(<DashboardError error={err} reset={reset} />);
    expect(screen.getByText(/Reference: dash-1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try Again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
