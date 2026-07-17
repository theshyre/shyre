import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const createMock = vi.fn().mockResolvedValue({ success: true });
const updateMock = vi.fn().mockResolvedValue({ success: true });
vi.mock("./actions", () => ({
  createProposalAction: (fd: FormData) => createMock(fd),
  updateProposalAction: (fd: FormData) => updateMock(fd),
}));

import { ProposalForm, type ProposalFormInitial } from "./proposal-form";

const TEAM = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";

const teams = [{ id: TEAM, name: "Malcom IO" }];
const customers = [{ id: CUSTOMER, name: "EyeReg Consulting", team_id: TEAM }];
const contacts = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Jordan Chen",
    email: "jordan@eyereg.example",
    customer_id: CUSTOMER,
  },
];

function renderForm(initial?: ProposalFormInitial): void {
  renderWithIntl(
    <ProposalForm
      teams={teams}
      customers={customers}
      contacts={contacts}
      initial={initial}
    />,
  );
}

function fillRequiredHeader(): void {
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Modernization work" },
  });
  fireEvent.change(screen.getByLabelText("Customer"), {
    target: { value: CUSTOMER },
  });
}

async function submit(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /Create proposal/ }));
  await Promise.resolve();
}

beforeEach(() => {
  createMock.mockClear();
  updateMock.mockClear();
});

describe("ProposalForm", () => {
  it("autofocuses the title (primary field)", () => {
    renderForm();
    expect(screen.getByLabelText("Title")).toHaveFocus();
  });

  it("adds and removes line items", () => {
    renderForm();
    expect(screen.getAllByLabelText("Project title")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Add line item/ }));
    expect(screen.getAllByLabelText("Project title")).toHaveLength(2);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove line item" })[0]!,
    );
    expect(screen.getAllByLabelText("Project title")).toHaveLength(1);
  });

  it("shows a live phase-sum mismatch that resolves when the sums match", () => {
    renderForm();
    fireEvent.change(screen.getAllByLabelText("Fixed price")[0]!, {
      target: { value: "4000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add phase/ }));
    fireEvent.change(screen.getByLabelText("Phase price"), {
      target: { value: "2200" },
    });
    expect(screen.getByText(/must equal/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Phase price"), {
      target: { value: "4000" },
    });
    expect(screen.queryByText(/must equal/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Phases sum to the item price"),
    ).toBeInTheDocument();
  });

  it("computes the selected-subset preview total from checked items", () => {
    renderForm();
    // Item 1: $950. Add item 2: $4000. New items start SELECTED (the preview
    // must never silently under-report), so with both checked the "Selected
    // total" equals "Full proposal": two $4,950 matches.
    fireEvent.change(screen.getAllByLabelText("Fixed price")[0]!, {
      target: { value: "950" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add line item/ }));
    fireEvent.change(screen.getAllByLabelText("Fixed price")[1]!, {
      target: { value: "4000" },
    });
    const previewChecks = screen
      .getAllByRole("checkbox")
      .filter((el) => el.closest("li"));
    expect(previewChecks[1]).toBeChecked();
    expect(screen.getAllByText("$4,950.00")).toHaveLength(2);

    // Unchecking the first drops the selected total to $4,000 (which then
    // matches twice: item 2's row price + the selected-total line) while the
    // full-proposal line stays at $4,950 (now the only match).
    fireEvent.click(previewChecks[0]!);
    expect(screen.getAllByText("$4,000.00")).toHaveLength(2);
    expect(screen.getAllByText("$4,950.00")).toHaveLength(1);

    // Removing the still-checked second item drops it from the preview
    // entirely — selection is keyed by stable key, not index, so nothing
    // shifts onto a neighbor.
    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove line item" })[1]!,
    );
    expect(screen.queryByText("$4,000.00")).not.toBeInTheDocument();
  });

  it("blocks submit client-side with field errors and never calls the action", async () => {
    renderForm();
    // Header fields carry native `required` (constraint validation blocks an
    // empty submit before zod runs), so fill them and leave the ITEM title
    // blank — that rule is zod/domain-owned and must surface as a FieldError.
    fillRequiredHeader();
    await submit();
    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    });
    expect(createMock).not.toHaveBeenCalled();
    // The domain key from the shared validator surfaces translated.
    expect(screen.getByText("Title is required")).toBeInTheDocument();
  });

  it("submits a valid payload with the full item tree", async () => {
    renderForm();
    fillRequiredHeader();
    fireEvent.change(screen.getByLabelText("Project title"), {
      target: { value: "Basic dependency upgrades" },
    });
    fireEvent.change(screen.getByLabelText("Fixed price"), {
      target: { value: "950" },
    });
    fireEvent.change(screen.getByLabelText("Signer (contact)"), {
      target: { value: contacts[0]!.id },
    });

    await submit();
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    const fd = createMock.mock.calls[0]![0] as FormData;
    const payload = JSON.parse(fd.get("payload") as string) as {
      team_id: string;
      customer_id: string;
      signer_contact_id: string;
      title: string;
      items: Array<{ title: string; fixedPrice: number }>;
    };
    expect(payload.team_id).toBe(TEAM);
    expect(payload.customer_id).toBe(CUSTOMER);
    expect(payload.signer_contact_id).toBe(contacts[0]!.id);
    expect(payload.title).toBe("Modernization work");
    expect(payload.items).toEqual([
      expect.objectContaining({
        title: "Basic dependency upgrades",
        fixedPrice: 950,
      }),
    ]);
  });

  it("edit mode posts the proposal id to updateProposalAction", async () => {
    const initial: ProposalFormInitial = {
      proposalId: "prop-1",
      team_id: TEAM,
      customer_id: CUSTOMER,
      signer_contact_id: null,
      title: "Existing draft",
      issued_date: "2026-07-16",
      valid_until: null,
      payment_terms_days: 30,
      deposit_type: "none",
      deposit_value: null,
      warranty_days: null,
      terms_notes: null,
      items: [
        {
          title: "Item A",
          description: null,
          whyItMatters: null,
          outOfScope: null,
          definitionOfDone: null,
          fixedPrice: 100,
          isCapped: false,
          phases: [],
        },
      ],
    };
    renderForm(initial);
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    const fd = updateMock.mock.calls[0]![0] as FormData;
    expect(fd.get("id")).toBe("prop-1");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("shows the deposit value input only for percent/amount deposits", () => {
    renderForm();
    expect(screen.queryByLabelText("Deposit (%)")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Deposit"), {
      target: { value: "percent" },
    });
    expect(screen.getByLabelText("Deposit (%)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Deposit"), {
      target: { value: "amount" },
    });
    expect(screen.getByLabelText("Deposit ($)")).toBeInTheDocument();
  });
});
