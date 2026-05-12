import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// global-error.tsx renders an entire <html><body> document. Test
// the body content (the ErrorDisplay).

describe("app/global-error.tsx", () => {
  it("renders ErrorDisplay inside a body with the digest passed through", async () => {
    const { default: GlobalError } = await import("./global-error");
    const reset = vi.fn();
    const err = Object.assign(new Error("global boom"), {
      digest: "global-1",
    });
    render(<GlobalError error={err} reset={reset} />);
    expect(screen.getByText(/Reference: global-1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try Again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("works without a digest", async () => {
    const { default: GlobalError } = await import("./global-error");
    const reset = vi.fn();
    render(<GlobalError error={new Error("no digest")} reset={reset} />);
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.queryByText(/Reference:/)).toBeNull();
  });

});
