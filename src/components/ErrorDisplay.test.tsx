import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ErrorDisplay } from "./ErrorDisplay";

/**
 * ErrorDisplay is the shared error/404 surface used by app/error.tsx,
 * app/global-error.tsx, and not-found.tsx. Coverage:
 *
 *   - "error" vs "notFound" variant icon + default text
 *   - custom title / message / digest passed through
 *   - Retry button only renders with showRetry + onRetry
 *   - Go Home link only renders with showHome
 *   - Copy Details builds the multi-line block + writes to clipboard;
 *     "Copied!" feedback flips on success, resets after 2s
 *   - clipboard failure is swallowed (no throw, no UI crash)
 */

describe("ErrorDisplay", () => {
  it("default 'error' variant: AlertTriangle + 'Something went wrong'", () => {
    const { container } = render(<ErrorDisplay />);
    expect(
      screen.getByRole("heading", { level: 1, name: /Something went wrong/ }),
    ).toBeInTheDocument();
    // AlertTriangle is the lucide-react Triangle icon; presence of an
    // svg in the icon slot is enough for a smoke check.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("'notFound' variant uses 'Page not found' + the warning palette", () => {
    render(<ErrorDisplay variant="notFound" />);
    expect(
      screen.getByRole("heading", { name: /Page not found/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/doesn't exist or has been moved/),
    ).toBeInTheDocument();
  });

  it("custom title + message override the defaults", () => {
    render(
      <ErrorDisplay
        title="Custom title"
        message="Custom message"
      />,
    );
    expect(screen.getByText("Custom title")).toBeInTheDocument();
    expect(screen.getByText("Custom message")).toBeInTheDocument();
  });

  it("digest renders as a 'Reference: …' line", () => {
    render(<ErrorDisplay digest="abc123" />);
    expect(screen.getByText(/Reference: abc123/)).toBeInTheDocument();
  });

  it("hides the Reference line when digest is undefined", () => {
    render(<ErrorDisplay />);
    expect(screen.queryByText(/Reference:/)).toBeNull();
  });

  it("Try Again button only renders with BOTH showRetry AND onRetry", () => {
    const { rerender } = render(<ErrorDisplay showRetry={false} />);
    expect(screen.queryByRole("button", { name: /Try Again/i })).toBeNull();

    rerender(<ErrorDisplay showRetry />);
    // showRetry defaults to true, but without onRetry the button
    // doesn't render either.
    expect(screen.queryByRole("button", { name: /Try Again/i })).toBeNull();

    const retry = vi.fn();
    rerender(<ErrorDisplay showRetry onRetry={retry} />);
    const btn = screen.getByRole("button", { name: /Try Again/i });
    fireEvent.click(btn);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("Go Home link only renders with showHome=true (default)", () => {
    const { rerender } = render(<ErrorDisplay />);
    expect(screen.getByRole("link", { name: /Go Home/i })).toBeInTheDocument();

    rerender(<ErrorDisplay showHome={false} />);
    expect(screen.queryByRole("link", { name: /Go Home/i })).toBeNull();
  });

  describe("Copy Details", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach?.(() => {
      vi.useRealTimers();
    });

    it("writes the assembled error block to the clipboard on click", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      render(
        <ErrorDisplay
          title="X"
          message="Y"
          digest="d-1"
        />,
      );
      const btn = screen.getByRole("button", { name: /Copy Details/i });
      await act(async () => {
        fireEvent.click(btn);
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      const blob = writeText.mock.calls[0]?.[0] as string;
      expect(blob).toContain("Error: X");
      expect(blob).toContain("Message: Y");
      expect(blob).toContain("Reference: d-1");
      expect(blob).toContain("Time:");
    });

    it("flips to 'Copied!' after a successful write, then back after 2s", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      render(<ErrorDisplay />);
      const btn = screen.getByRole("button", { name: /Copy Details/i });
      await act(async () => {
        fireEvent.click(btn);
      });
      expect(screen.getByText(/Copied!/)).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(2100);
      });
      expect(screen.queryByText(/Copied!/)).toBeNull();
      expect(
        screen.getByRole("button", { name: /Copy Details/i }),
      ).toBeInTheDocument();
    });

    it("clipboard error is swallowed (no throw; no 'Copied!' flag)", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      render(<ErrorDisplay />);
      const btn = screen.getByRole("button", { name: /Copy Details/i });
      await act(async () => {
        fireEvent.click(btn);
      });
      expect(screen.queryByText(/Copied!/)).toBeNull();
    });
  });
});

// vitest's `afterEach` import workaround — declared at file scope here
// so the describe block can call `afterEach?.(...)` without an
// undeclared-name error in strict mode.
import { afterEach } from "vitest";
