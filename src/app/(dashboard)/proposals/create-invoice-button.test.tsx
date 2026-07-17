import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const billMock = vi.fn();
vi.mock("./actions", () => ({
  createInvoiceFromProposalAction: (fd: FormData) => billMock(fd),
}));

import { CreateInvoiceButton } from "./create-invoice-button";

beforeEach(() => billMock.mockReset());

describe("CreateInvoiceButton", () => {
  it("bills with the proposal id", async () => {
    billMock.mockResolvedValue({ success: true });
    renderWithIntl(<CreateInvoiceButton proposalId="prop-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Create invoice/ }));
    await waitFor(() => expect(billMock).toHaveBeenCalledTimes(1));
    expect((billMock.mock.calls[0]![0] as FormData).get("id")).toBe("prop-1");
  });

  it("surfaces failure inline", async () => {
    billMock.mockResolvedValue({
      success: false,
      error: { message: "Every accepted line item has already been invoiced." },
    });
    renderWithIntl(<CreateInvoiceButton proposalId="prop-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Create invoice/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/already been invoiced/),
    );
  });
});
