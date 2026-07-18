import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/intl";
import { AgentEntryReview, type AgentReviewRow } from "./agent-entry-review";

function row(
  overrides: Partial<AgentReviewRow> & { id: string },
): AgentReviewRow {
  return {
    agentLabel: "Claude Code",
    userId: "u1",
    personName: "Marcus",
    description: "Refactor auth module",
    projectName: "EyeReg",
    date: "2026-07-18",
    durationMin: 90,
    excluded: false,
    conflict: null,
    ...overrides,
  };
}

describe("AgentEntryReview", () => {
  it("renders nothing when there are no agent entries", () => {
    const { container } = renderWithIntl(
      <AgentEntryReview rows={[]} onToggleExclude={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the agent label, author, entry context, and duration for each row", () => {
    renderWithIntl(
      <AgentEntryReview
        rows={[row({ id: "e1" })]}
        onToggleExclude={() => {}}
      />,
    );
    expect(screen.getByText("Agent-tracked time")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    // Authorship mandate: whose account the agent ran under.
    expect(screen.getByText("Marcus")).toBeInTheDocument();
    expect(
      screen.getByText(/Refactor auth module · EyeReg · 2026-07-18 ·/),
    ).toBeInTheDocument();
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
  });

  it("falls back to a generic 'Agent' label when agent_label is null", () => {
    renderWithIntl(
      <AgentEntryReview
        rows={[row({ id: "e1", agentLabel: null })]}
        onToggleExclude={() => {}}
      />,
    );
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });

  it("shows the overlap warning badge only on conflicted rows", () => {
    renderWithIntl(
      <AgentEntryReview
        rows={[
          row({
            id: "conflicted",
            conflict: {
              description: "Sprint planning",
              date: "2026-07-18",
              personName: "Marcus",
            },
          }),
          row({ id: "clean", description: "Docs pass" }),
        ]}
        onToggleExclude={() => {}}
      />,
    );
    expect(screen.getAllByText("Overlaps your tracked time")).toHaveLength(1);
  });

  it("renders the conflict detail as visible text naming the entry and its author (not tooltip-only)", () => {
    renderWithIntl(
      <AgentEntryReview
        rows={[
          row({
            id: "conflicted",
            conflict: {
              description: "Sprint planning",
              date: "2026-07-18",
              personName: "Dana",
            },
          }),
        ]}
        onToggleExclude={() => {}}
      />,
    );
    // Behavior, not copy: the visible detail names the conflicting
    // entry AND its author (both appear together in one element).
    expect(
      screen.getByText((text) => /Sprint planning/.test(text) && /Dana/.test(text)),
    ).toBeInTheDocument();
  });

  it("truncates long conflicting-entry names with an ellipsis", () => {
    const longTitle =
      "Quarterly platform migration retro and follow-up items list";
    renderWithIntl(
      <AgentEntryReview
        rows={[
          row({
            id: "conflicted",
            conflict: {
              description: longTitle,
              date: "2026-07-18",
              personName: "Dana",
            },
          }),
        ]}
        onToggleExclude={() => {}}
      />,
    );
    expect(screen.queryByText(new RegExp(longTitle))).not.toBeInTheDocument();
    // Tooltip + visible detail may each carry the ellipsis — assert
    // at least one truncated rendering exists.
    expect(screen.getAllByText(/…/).length).toBeGreaterThan(0);
  });

  it("announces the excluded count via a polite status region", () => {
    const { rerender } = renderWithIntl(
      <AgentEntryReview
        rows={[row({ id: "e1" })]}
        onToggleExclude={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "No entries excluded from this invoice.",
    );
    rerender(
      <AgentEntryReview
        rows={[row({ id: "e1", excluded: true })]}
        onToggleExclude={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 entry excluded from this invoice.",
    );
  });

  it("offers a one-click Exclude that reports the entry id", async () => {
    const user = userEvent.setup();
    const onToggleExclude = vi.fn();
    renderWithIntl(
      <AgentEntryReview
        rows={[row({ id: "e1" })]}
        onToggleExclude={onToggleExclude}
      />,
    );
    await user.click(screen.getByRole("button", { name: /exclude/i }));
    expect(onToggleExclude).toHaveBeenCalledWith("e1", true);
  });

  it("shows an Excluded chip and an Include undo on excluded rows", async () => {
    const user = userEvent.setup();
    const onToggleExclude = vi.fn();
    renderWithIntl(
      <AgentEntryReview
        rows={[row({ id: "e1", excluded: true })]}
        onToggleExclude={onToggleExclude}
      />,
    );
    expect(screen.getByText("Excluded")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /include/i }));
    expect(onToggleExclude).toHaveBeenCalledWith("e1", false);
  });

  it("labels the exclude control with the entry it targets", () => {
    renderWithIntl(
      <AgentEntryReview
        rows={[row({ id: "e1", description: "Refactor auth module" })]}
        onToggleExclude={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: 'Exclude "Refactor auth module" from this invoice',
      }),
    ).toBeInTheDocument();
  });
});
