import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { InlineErrorCard } from "./InlineErrorCard";

describe("InlineErrorCard", () => {
  it("renders the title (and message when provided)", () => {
    renderWithIntl(
      <InlineErrorCard title="Save failed" message="Try again later." />,
    );
    expect(screen.getByText("Save failed")).toBeInTheDocument();
    expect(screen.getByText("Try again later.")).toBeInTheDocument();
  });

  it("omits the message paragraph when not provided", () => {
    const { container } = renderWithIntl(
      <InlineErrorCard title="Bare" />,
    );
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
  });

  it("renders the context entries as a definition list", () => {
    renderWithIntl(
      <InlineErrorCard
        title="X"
        context={{ status: "404", endpoint: "/v2/clients" }}
      />,
    );
    expect(screen.getByText("status")).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByText("endpoint")).toBeInTheDocument();
    expect(screen.getByText("/v2/clients")).toBeInTheDocument();
  });

  it("starts collapsed; reveals detail when 'Show details' is clicked; toggles back to 'Show details' after a second click", () => {
    renderWithIntl(
      <InlineErrorCard title="X" detail="stack trace contents" />,
    );
    expect(screen.queryByText(/stack trace contents/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /show details/i }));
    expect(screen.getByText(/stack trace contents/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /hide details/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /hide details/i }));
    expect(screen.queryByText(/stack trace contents/)).toBeNull();
  });

  it("hides the Show Details button when no detail prop is provided", () => {
    renderWithIntl(<InlineErrorCard title="X" />);
    expect(
      screen.queryByRole("button", { name: /show details/i }),
    ).toBeNull();
  });

  it("retry button only renders when onRetry is provided", () => {
    const { rerender } = renderWithIntl(<InlineErrorCard title="X" />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    const onRetry = vi.fn();
    rerender(<InlineErrorCard title="X" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  describe("Copy details", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("builds the structured payload (title/message/context/detail/meta) and writes it to clipboard", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      renderWithIntl(
        <InlineErrorCard
          title="Save failed"
          message="Try later"
          context={{ status: "500" }}
          detail="big stack"
        />,
      );
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /copy details/i }),
        );
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      const blob = writeText.mock.calls[0]?.[0] as string;
      expect(blob).toContain("Error: Save failed");
      expect(blob).toContain("Message: Try later");
      expect(blob).toContain("status: 500");
      expect(blob).toContain("big stack");
      expect(blob).toContain("Time:");
    });

    it("flips to Copied! for 2s on success, then back", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      renderWithIntl(<InlineErrorCard title="X" />);
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /copy details/i }),
        );
      });
      expect(
        screen.getByRole("button", { name: /copied/i }),
      ).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(2100);
      });
      expect(
        screen.getByRole("button", { name: /copy details/i }),
      ).toBeInTheDocument();
    });
  });

  it("has role='alert' so screen readers announce on mount", () => {
    const { container } = renderWithIntl(
      <InlineErrorCard title="X" />,
    );
    expect(
      container.querySelector("[role='alert']"),
    ).not.toBeNull();
  });
});
