import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  screen,
  fireEvent,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithIntl } from "@/test/intl";
import { ToastProvider } from "@/components/Toast";
import {
  bulkStripButtonClass,
  bulkStripDangerButtonClass,
} from "@/lib/table-styles";
import { checkboxClass } from "@/lib/form-styles";

const {
  bulkArchiveMock,
  bulkRestoreMock,
  deactivateMock,
  reactivateMock,
} = vi.hoisted(() => ({
  bulkArchiveMock: vi.fn(async (_fd: FormData) => {}),
  bulkRestoreMock: vi.fn(async (_fd: FormData) => {}),
  deactivateMock: vi.fn(async (_fd: FormData) => {}),
  reactivateMock: vi.fn(async (_fd: FormData) => {}),
}));

vi.mock("./actions", () => ({
  archiveCustomerAction: vi.fn(async (_fd: FormData) => {}),
  bulkArchiveCustomersAction: bulkArchiveMock,
  bulkRestoreCustomersAction: bulkRestoreMock,
  deactivateCustomerAction: deactivateMock,
  reactivateCustomerAction: reactivateMock,
}));

import { CustomersTable, type CustomerRow } from "./customers-table";

function makeCustomer(
  id: string,
  name: string,
  overrides?: Partial<CustomerRow>,
): CustomerRow {
  return {
    id,
    team_id: "t1",
    name,
    email: `${id}@example.com`,
    default_rate: 100,
    bounced_at: null,
    complained_at: null,
    logo_url: null,
    inactive_at: null,
    ...overrides,
  };
}

const twoCustomers = [makeCustomer("c1", "Acme"), makeCustomer("c2", "Globex")];

function renderTable(ui: ReactElement): RenderResult {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

function defaultProps(): {
  customers: CustomerRow[];
  totalCount: number;
  shareCounts: Map<string, number>;
  teamNameById: Map<string, string>;
} {
  return {
    customers: twoCustomers,
    totalCount: 2,
    shareCounts: new Map<string, number>(),
    teamNameById: new Map([["t1", "Team One"]]),
  };
}

beforeEach(() => {
  bulkArchiveMock.mockClear();
  bulkRestoreMock.mockClear();
  deactivateMock.mockClear();
  reactivateMock.mockClear();
});

describe("CustomersTable selection checkboxes", () => {
  it("uses checkboxClass on the strip master, thead master, and row checkboxes", () => {
    renderTable(<CustomersTable {...defaultProps()} />);
    const checkboxes = screen.getAllByRole("checkbox");
    // strip master + thead master + 2 rows
    expect(checkboxes).toHaveLength(4);
    for (const cb of checkboxes) {
      expect(cb.className).toBe(checkboxClass);
    }
  });

  it("names the entity in each row checkbox's aria-label", () => {
    renderTable(<CustomersTable {...defaultProps()} />);
    expect(screen.getByLabelText("Select Acme")).toBeInTheDocument();
    expect(screen.getByLabelText("Select Globex")).toBeInTheDocument();
  });

  it("both master checkboxes toggle the full selection", () => {
    renderTable(<CustomersTable {...defaultProps()} />);
    const masters = screen.getAllByLabelText("Select all customers");
    expect(masters).toHaveLength(2);
    const firstMaster = masters[0] as HTMLInputElement;
    fireEvent.click(firstMaster);
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
    const deselect = screen.getAllByLabelText("Deselect all customers");
    expect(deselect).toHaveLength(2);
  });
});

describe("CustomersTable bulk strip", () => {
  it("styles Mark-inactive neutral and Archive as danger text on neutral chrome", () => {
    renderTable(<CustomersTable {...defaultProps()} />);
    fireEvent.click(screen.getByLabelText("Select Acme"));
    const deactivate = screen.getByRole("button", {
      name: "Mark inactive (1)",
    });
    const archive = screen.getByRole("button", { name: "Archive 1" });
    // Constant equality is the whole assertion: the shared classes ARE
    // the list-page grammar (neutral chrome, danger-as-red-text, no
    // soft-fill). Token-substring checks on top of this were fragile
    // duplicates — the constants' content is owned by form-styles.
    expect(deactivate.className).toBe(bulkStripButtonClass);
    expect(archive.className).toBe(bulkStripDangerButtonClass);
  });

  it("shows a visible Clear button that empties the selection", () => {
    renderTable(<CustomersTable {...defaultProps()} />);
    fireEvent.click(screen.getByLabelText("Select Acme"));
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText("1 of 2 selected")).toBeNull();
    expect(
      screen.getByText("Select rows to archive in bulk"),
    ).toBeInTheDocument();
  });

  it("bulk archive calls the action and offers Undo that restores", async () => {
    renderTable(<CustomersTable {...defaultProps()} />);
    fireEvent.click(screen.getAllByLabelText("Select all customers")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Archive 2" }));
    await waitFor(() => expect(bulkArchiveMock).toHaveBeenCalledTimes(1));
    const fd = bulkArchiveMock.mock.calls[0]![0];
    expect(fd.getAll("id").sort()).toEqual(["c1", "c2"]);
    const undo = await screen.findByRole("button", { name: "Undo" });
    fireEvent.click(undo);
    await waitFor(() => expect(bulkRestoreMock).toHaveBeenCalledTimes(1));
    expect(bulkRestoreMock.mock.calls[0]![0].getAll("id").sort()).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("bulk mark-inactive calls the action and Undo reactivates", async () => {
    renderTable(<CustomersTable {...defaultProps()} />);
    fireEvent.click(screen.getByLabelText("Select Globex"));
    fireEvent.click(screen.getByRole("button", { name: "Mark inactive (1)" }));
    await waitFor(() => expect(deactivateMock).toHaveBeenCalledTimes(1));
    expect(deactivateMock.mock.calls[0]![0].getAll("id")).toEqual(["c2"]);
    const undo = await screen.findByRole("button", { name: "Undo" });
    fireEvent.click(undo);
    await waitFor(() => expect(reactivateMock).toHaveBeenCalledTimes(1));
  });
});

describe("CustomersTable Escape guard", () => {
  it("clears the selection on Escape even when a checkbox has focus", () => {
    renderTable(<CustomersTable {...defaultProps()} />);
    const rowCheckbox = screen.getByLabelText("Select Acme");
    fireEvent.click(rowCheckbox);
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
    (rowCheckbox as HTMLInputElement).focus();
    fireEvent.keyDown(rowCheckbox, { key: "Escape" });
    expect(screen.queryByText("1 of 2 selected")).toBeNull();
  });

  it("leaves the selection alone when Escape comes from a text-editing control", () => {
    renderTable(
      <>
        <input aria-label="Some text field" type="text" />
        <CustomersTable {...defaultProps()} />
      </>,
    );
    fireEvent.click(screen.getByLabelText("Select Acme"));
    const textField = screen.getByLabelText("Some text field");
    textField.focus();
    fireEvent.keyDown(textField, { key: "Escape" });
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
  });
});

describe("CustomersTable live region", () => {
  it("announces the result count, then N selected on selection change", async () => {
    renderTable(<CustomersTable {...defaultProps()} />);
    const region = screen.getByRole("status");
    await waitFor(() =>
      expect(region).toHaveTextContent("2 customers shown"),
    );
    fireEvent.click(screen.getByLabelText("Select Acme"));
    await waitFor(() =>
      expect(region).toHaveTextContent("1 customer selected"),
    );
  });

  it("renders exactly one polite live region", () => {
    renderTable(<CustomersTable {...defaultProps()} />);
    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveAttribute("aria-live", "polite");
  });
});

describe("CustomersTable archived view (restore surface)", () => {
  it("keeps Restore working: badge on rows, bulk Restore button, no Archive", async () => {
    renderTable(
      <CustomersTable
        {...defaultProps()}
        view="archived"
        customers={[makeCustomer("c1", "Acme")]}
        totalCount={1}
      />,
    );
    expect(screen.getByText("Archived")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select Acme"));
    expect(
      screen.queryByRole("button", { name: "Archive 1" }),
    ).toBeNull();
    const restore = screen.getByRole("button", { name: "Restore (1)" });
    expect(restore.className).toBe(bulkStripButtonClass);
    fireEvent.click(restore);
    await waitFor(() => expect(bulkRestoreMock).toHaveBeenCalledTimes(1));
    expect(bulkRestoreMock.mock.calls[0]![0].getAll("id")).toEqual(["c1"]);
  });

  it("shows the archived empty state", () => {
    renderTable(
      <CustomersTable
        {...defaultProps()}
        view="archived"
        customers={[]}
        totalCount={0}
      />,
    );
    expect(screen.getByText("No archived customers")).toBeInTheDocument();
  });
});
