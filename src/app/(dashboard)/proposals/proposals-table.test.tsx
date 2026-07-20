import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

// PaginationFooter (rendered by the table) reads the URL.
vi.mock("next/navigation", () => ({
  usePathname: () => "/proposals",
  useSearchParams: () => new URLSearchParams(),
}));

const toastPush = vi.fn();
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ push: toastPush }),
}));

const bulkDeleteMock = vi.fn();
vi.mock("./actions", () => ({
  bulkDeleteProposalsAction: (fd: FormData) => bulkDeleteMock(fd),
}));

import { ProposalsTable, type ProposalRow } from "./proposals-table";

const TODAY = "2026-07-17";

function row(overrides: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: "p1",
    proposal_number: "PROP-2026-001",
    title: "Modernization work",
    status: "draft",
    issued_date: "2026-07-16",
    valid_until: null,
    currency: "USD",
    customer: { id: "c1", name: "EyeReg Consulting", logo_url: null },
    total: 4950,
    accepted_total: null,
    signoff: null,
    ...overrides,
  };
}

function renderTable(
  proposals: ProposalRow[],
  totalCount = proposals.length,
): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <>
      <input type="text" aria-label="Outside text field" />
      <ProposalsTable proposals={proposals} totalCount={totalCount} today={TODAY} />
    </>,
  );
}

beforeEach(() => {
  toastPush.mockReset();
  bulkDeleteMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProposalsTable rendering", () => {
  it("shows the empty state as a bordered card with an icon circle", () => {
    const { container } = renderWithIntl(
      <ProposalsTable proposals={[]} totalCount={0} today={TODAY} />,
    );
    const heading = screen.getByText("No proposals yet");
    expect(heading).toBeInTheDocument();
    // The former marketing subtitle's copy lives here now.
    expect(
      screen.getByText(/draft a fixed-price quote, send it for sign-off/i),
    ).toBeInTheDocument();
    // Bordered-card + icon-circle treatment (list-pages.md rule 6,
    // reference: invoices-table.tsx).
    const card = heading.closest("div");
    expect(card?.className).toMatch(/border-edge/);
    expect(card?.className).toMatch(/rounded-lg/);
    expect(card?.querySelector(".rounded-full svg")).not.toBeNull();
    // No table is rendered.
    expect(container.querySelector("table")).toBeNull();
  });

  it("renders number, title, customer, status, and formatted total", () => {
    renderTable([row()]);
    expect(
      screen.getByRole("link", { name: "PROP-2026-001" }),
    ).toHaveAttribute("href", "/proposals/p1");
    expect(screen.getByText("Modernization work")).toBeInTheDocument();
    expect(screen.getByText("EyeReg Consulting")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("$4,950.00")).toBeInTheDocument();
    // Dates render localized via the shared formatDate, not raw ISO.
    expect(screen.getByText("Jul 16, 2026")).toBeInTheDocument();
  });

  it("renders a dash for a missing customer", () => {
    renderTable([row({ customer: null })]);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an aging caption on in-flight rows sent 1+ days ago", () => {
    renderTable([
      row({ id: "p1", status: "sent", issued_date: "2026-07-10" }),
      row({
        id: "p2",
        proposal_number: "PROP-2026-002",
        status: "viewed",
        issued_date: "2026-07-17",
      }),
      row({
        id: "p3",
        proposal_number: "PROP-2026-003",
        status: "draft",
        issued_date: "2026-07-01",
      }),
    ]);
    // 7 days for the sent row; nothing for same-day or draft rows.
    expect(screen.getByText("sent 7d ago")).toBeInTheDocument();
    expect(screen.getAllByText(/sent \d+d ago/)).toHaveLength(1);
  });

  it("relabels a lapsed sent proposal as Expired (read-time cue)", () => {
    renderTable([row({ status: "sent", valid_until: "2026-07-01" })]);
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.queryByText("Sent")).not.toBeInTheDocument();
  });

  it("keeps the Sent badge while valid_until is still in the future", () => {
    renderTable([row({ status: "sent", valid_until: "2026-08-01" })]);
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.queryByText("Expired")).not.toBeInTheDocument();
  });

  it("shows the accepted subset total instead of the full total once accepted", () => {
    renderTable([
      row({ status: "accepted", total: 4950, accepted_total: 3000 }),
    ]);
    expect(screen.getByText("$3,000.00")).toBeInTheDocument();
    expect(screen.queryByText("$4,950.00")).not.toBeInTheDocument();
  });

  it("renders a load-more footer when more rows match than are loaded", () => {
    renderTable([row()], 120);
    expect(screen.getByText("Showing 1 of 120")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Load 50 more/ }),
    ).toBeInTheDocument();
  });

  it("omits the footer when everything is loaded", () => {
    renderTable([row()], 1);
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });
});

describe("ProposalsTable selection", () => {
  it("names each deletable row checkbox after its proposal number", () => {
    renderTable([row()]);
    expect(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-001" }),
    ).toBeInTheDocument();
  });

  it("disables the row checkbox for a non-deletable proposal with an explanatory, keyboard-discoverable tooltip", () => {
    const { container } = renderTable([row({ status: "accepted" })]);
    // Non-deletable rows carry no "Select proposal …" accessible name.
    expect(
      screen.queryByRole("checkbox", {
        name: "Select proposal PROP-2026-001",
      }),
    ).not.toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    const locked = checkboxes.find((cb) => cb.disabled);
    expect(locked).toBeDefined();
    // showOnDisabled wraps it in a focusable span carrying the reason as
    // its accessible name, so keyboard users can still discover it.
    const wrapper = container.querySelector("tbody span[aria-label]");
    expect(wrapper?.getAttribute("aria-label")).toContain("PROP-2026-001");
    expect(wrapper?.getAttribute("tabindex")).toBe("0");
  });

  it("toggles a single row on click", () => {
    renderTable([row()]);
    const box = screen.getByRole("checkbox", {
      name: "Select proposal PROP-2026-001",
    });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
  });

  it("shows the bulk-action toolbar and 'N selected' once a row is checked", () => {
    renderTable([row()]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-001" }),
    );
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("master checkbox selects/deselects every deletable row, ignores locked ones, and goes indeterminate on a partial selection", () => {
    renderTable([
      row({ id: "p1", proposal_number: "PROP-2026-001", status: "draft" }),
      row({ id: "p2", proposal_number: "PROP-2026-002", status: "draft" }),
      row({ id: "p3", proposal_number: "PROP-2026-003", status: "accepted" }),
    ]);
    const master = screen.getByRole("checkbox", {
      name: "Select all deletable",
    });
    fireEvent.click(master);
    expect(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-001" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-002" }),
    ).toBeChecked();
    // The master flips its label once everything selectable is selected.
    expect(
      screen.getByRole("checkbox", { name: "Deselect all" }),
    ).toBeInTheDocument();

    // Deselect one row — master must go back to a partial (indeterminate)
    // state, not "all selected".
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-001" }),
    );
    const partialMaster = screen.getByRole("checkbox", {
      name: "Select all deletable",
    }) as HTMLInputElement;
    expect(partialMaster.indeterminate).toBe(true);
  });

  it("disables the master checkbox when nothing on the page is deletable", () => {
    renderTable([
      row({ status: "accepted" }),
      row({ id: "p2", status: "sent" }),
    ]);
    const master = screen.getByRole("checkbox", {
      name: "Select all deletable",
    });
    expect(master).toBeDisabled();
  });

  it("clears the selection on Escape from a checkbox (a non-text-editing input)", () => {
    renderTable([row()]);
    const box = screen.getByRole("checkbox", {
      name: "Select proposal PROP-2026-001",
    });
    fireEvent.click(box);
    expect(box).toBeChecked();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box).not.toBeChecked();
  });

  it("does NOT clear the selection on Escape from a text-editing control", () => {
    renderTable([row()]);
    const box = screen.getByRole("checkbox", {
      name: "Select proposal PROP-2026-001",
    });
    fireEvent.click(box);
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Outside text field" }),
      { key: "Escape" },
    );
    expect(box).toBeChecked();
  });

  it("offers a visible Clear button that drops the selection and collapses the toolbar", () => {
    renderTable([row()]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-001" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-001" }),
    ).not.toBeChecked();
  });

  it("announces the selection count in a polite live region (debounced)", () => {
    vi.useFakeTimers();
    renderTable([row()]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-001" }),
    );
    // Not yet announced — debounced.
    expect(screen.getByRole("status")).toHaveTextContent("");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 proposal selected",
    );
  });
});

describe("ProposalsTable bulk delete", () => {
  it("arms a typed-delete confirm instead of firing immediately", () => {
    renderTable([row()]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-001" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(bulkDeleteMock).not.toHaveBeenCalled();
    expect(
      screen.getByText("Type delete to delete 1 proposal"),
    ).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Confirm delete" });
    expect(confirm).toBeDisabled();
  });

  it("stays disabled until the exact word 'delete' is typed, then fires with the selected ids", async () => {
    bulkDeleteMock.mockResolvedValue({ success: true, deleted: 1, skipped: 0 });
    renderTable([
      row({ id: "p1", proposal_number: "PROP-2026-001" }),
      row({ id: "p2", proposal_number: "PROP-2026-002" }),
    ]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-001" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-002" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    const input = screen.getByLabelText("Type delete to confirm");
    const confirm = screen.getByRole("button", { name: "Confirm delete" });

    fireEvent.change(input, { target: { value: "nope" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: "delete" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(bulkDeleteMock).toHaveBeenCalledTimes(1));
    const fd = bulkDeleteMock.mock.calls[0]?.[0] as FormData;
    expect(fd.getAll("id").sort()).toEqual(["p1", "p2"]);
  });

  it("toasts an honest count and clears the selection on success", async () => {
    bulkDeleteMock.mockResolvedValue({ success: true, deleted: 1, skipped: 0 });
    renderTable([row()]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-001" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    fireEvent.change(screen.getByLabelText("Type delete to confirm"), {
      target: { value: "delete" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() =>
      expect(toastPush).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "success",
          message: "Deleted 1 proposal",
        }),
      ),
    );
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("toasts the honest deleted/skipped split when some rows were skipped server-side", async () => {
    bulkDeleteMock.mockResolvedValue({ success: true, deleted: 1, skipped: 2 });
    renderTable([
      row({ id: "p1", proposal_number: "PROP-2026-001" }),
      row({ id: "p2", proposal_number: "PROP-2026-002" }),
      row({ id: "p3", proposal_number: "PROP-2026-003" }),
    ]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all deletable" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    fireEvent.change(screen.getByLabelText("Type delete to confirm"), {
      target: { value: "delete" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() =>
      expect(toastPush).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "success",
          message: "Deleted 1 proposal · 2 skipped (not deletable)",
        }),
      ),
    );
  });

  it("surfaces an error toast and keeps the confirm armed (never a silent failure) when the action fails", async () => {
    bulkDeleteMock.mockResolvedValue({
      success: false,
      error: { message: "Only team owners and admins can perform this action." },
    });
    renderTable([row()]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-001" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    fireEvent.change(screen.getByLabelText("Type delete to confirm"), {
      target: { value: "delete" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() =>
      expect(toastPush).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "error",
          message: "Only team owners and admins can perform this action.",
        }),
      ),
    );
    // The typed confirm stays armed and the selection survives — the
    // user can retry without re-arming from scratch.
    expect(
      screen.getByRole("button", { name: "Confirm delete" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select proposal PROP-2026-001" }),
    ).toBeChecked();
  });

  it("Cancel collapses the confirm without firing and keeps the selection", () => {
    renderTable([row()]);
    const box = screen.getByRole("checkbox", {
      name: "Select proposal PROP-2026-001",
    });
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(bulkDeleteMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Type delete to delete/)).not.toBeInTheDocument();
    expect(box).toBeChecked();
  });

  it("Escape collapses the armed confirm WITHOUT also clearing the selection", () => {
    renderTable([row()]);
    const box = screen.getByRole("checkbox", {
      name: "Select proposal PROP-2026-001",
    });
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByText(/Type delete to delete/)).not.toBeInTheDocument();
    expect(box).toBeChecked();
  });
});
