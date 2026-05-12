import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

describe("app/error.tsx (route-level error boundary)", () => {
  it("renders ErrorDisplay with the error digest and a working reset", async () => {
    const { default: AppError } = await import("./error");
    const reset = vi.fn();
    const err = Object.assign(new Error("boom"), { digest: "err-digest-1" });
    render(<AppError error={err} reset={reset} />);
    expect(screen.getByText(/Reference: err-digest-1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try Again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("works without a digest (some errors don't have one)", async () => {
    const { default: AppError } = await import("./error");
    const err = new Error("no digest");
    render(<AppError error={err} reset={vi.fn()} />);
    // No 'Reference:' line.
    expect(screen.queryByText(/Reference:/)).toBeNull();
    // Default error title still renders.
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
  });
});
