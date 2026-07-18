import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/intl";
import { NewInvoiceForm, type PreviewCandidate } from "./new-invoice-form";

// The form only holds a reference to the server action; the action
// module itself pulls server-only deps that can't load in jsdom.
vi.mock("../actions", () => ({
  createInvoiceAction: vi.fn(async () => ({ success: true })),
}));

function candidate(
  overrides: Partial<PreviewCandidate> & { id: string },
): PreviewCandidate {
  return {
    durationMin: 60,
    rate: 100,
    description: null,
    projectName: "EyeReg",
    projectInvoiceCode: null,
    taskName: null,
    personName: "Marcus",
    date: "2026-07-18",
    customerId: "c1",
    projectId: "p1",
    teamId: "team-1",
    userId: "u1",
    startTime: "2026-07-18T09:00:00+00:00",
    endTime: "2026-07-18T10:00:00+00:00",
    startedByKind: "user",
    agentLabel: null,
    ...overrides,
  };
}

const humanEntry = candidate({
  id: "h1",
  description: "Standup + review",
});

// Overlaps the human entry: same user, same project, 09:30–11:00.
const agentEntry = candidate({
  id: "a1",
  description: "Refactor auth module",
  durationMin: 90,
  startTime: "2026-07-18T09:30:00+00:00",
  endTime: "2026-07-18T11:00:00+00:00",
  startedByKind: "agent",
  agentLabel: "Claude Code",
});

function renderForm(candidates: PreviewCandidate[]) {
  return renderWithIntl(
    <NewInvoiceForm
      customers={[
        {
          id: "c1",
          name: "Acme",
          default_rate: 100,
          payment_terms_days: null,
        },
      ]}
      candidates={candidates}
      expenseCandidates={[]}
      lastInvoiceEndByCustomer={{}}
      defaultTaxRate={0}
      teamDefaultTermsDays={null}
      previewInvoiceNumber={null}
      businessName={null}
      teams={[]}
    />,
  );
}

describe("NewInvoiceForm — agent-time review (SAL-051 P3)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows the agent review section with Bot-attributed label and overlap warning", () => {
    renderForm([humanEntry, agentEntry]);
    expect(screen.getByText("Agent-tracked time")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    // Overlap: agent 09:30–11:00 vs the same user's 09:00–10:00 on
    // the same project → warning badge (icon + text channels).
    expect(
      screen.getByText("Overlaps your tracked time"),
    ).toBeInTheDocument();
  });

  it("does not render the agent section when no agent entries are in scope", () => {
    renderForm([humanEntry]);
    expect(screen.queryByText("Agent-tracked time")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent hours")).not.toBeInTheDocument();
  });

  it("shows the 'Agent hours' subtotal only when agent time is selected", () => {
    renderForm([humanEntry, agentEntry]);
    const label = screen.getByText("Agent hours");
    const row = label.closest("div");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("1h 30m")).toBeInTheDocument();
  });

  it("no warning when the agent worked on a different project", () => {
    renderForm([
      humanEntry,
      candidate({
        ...agentEntry,
        id: "a2",
        projectId: "p2",
        projectName: "Spike",
      }),
    ]);
    expect(screen.getByText("Agent-tracked time")).toBeInTheDocument();
    expect(
      screen.queryByText("Overlaps your tracked time"),
    ).not.toBeInTheDocument();
  });

  it("one-click Exclude unchecks the entry: totals drop, hidden input posts the id, Include undoes", async () => {
    const user = userEvent.setup();
    const { container } = renderForm([humanEntry, agentEntry]);

    // 60 + 90 min selected initially. Anchor on the rail's "Total
    // hours" row so an unrelated "2.50" elsewhere can't satisfy it.
    const hoursRow = (): HTMLElement =>
      screen.getByText("Total hours").closest("div") as HTMLElement;
    expect(within(hoursRow()).getByText("2.50")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^exclude/i }));

    // Selection drops to the human entry only; agent subtotal gone.
    expect(within(hoursRow()).getByText("1.00")).toBeInTheDocument();
    expect(screen.queryByText("Agent hours")).not.toBeInTheDocument();
    expect(screen.getByText("Excluded")).toBeInTheDocument();

    // The exclusion rides to the server action via a hidden input so
    // posted === preview. No mutation of the entry itself.
    const hidden = container.querySelector<HTMLInputElement>(
      'input[name="excluded_entry_ids[]"]',
    );
    expect(hidden?.value).toBe("a1");

    // Include restores the original selection.
    await user.click(screen.getByRole("button", { name: /^include/i }));
    expect(within(hoursRow()).getByText("2.50")).toBeInTheDocument();
    expect(
      container.querySelector('input[name="excluded_entry_ids[]"]'),
    ).toBeNull();
  });

  it("resets exclusions when the customer changes (decisions belong to the old candidate set)", async () => {
    const user = userEvent.setup();
    const { container } = renderForm([humanEntry, agentEntry]);

    await user.click(screen.getByRole("button", { name: /^exclude/i }));
    expect(
      container.querySelector('input[name="excluded_entry_ids[]"]'),
    ).not.toBeNull();

    await user.selectOptions(
      screen.getByLabelText("Select a customer"),
      "c1",
    );
    expect(
      container.querySelector('input[name="excluded_entry_ids[]"]'),
    ).toBeNull();
    expect(screen.queryByText("Excluded")).not.toBeInTheDocument();
  });

  it("documents the detector's scope boundary: no warning when the overlapping human entry is not a candidate", () => {
    // An already-invoiced human entry never reaches the builder
    // (page.tsx queries invoiced=false only), so an agent entry
    // overlapping it draws NO warning. Accepted product limitation:
    // the detector is a pure client-side pass over the loaded
    // candidates — widening it would need a second query.
    renderForm([agentEntry]);
    expect(screen.getByText("Agent-tracked time")).toBeInTheDocument();
    expect(
      screen.queryByText("Overlaps your tracked time"),
    ).not.toBeInTheDocument();
  });
});
