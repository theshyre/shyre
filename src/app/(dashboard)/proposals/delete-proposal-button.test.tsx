import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const deleteMock = vi.fn();
vi.mock("./actions", () => ({
  deleteProposalAction: (fd: FormData) => deleteMock(fd),
}));

import { DeleteProposalButton } from "./delete-proposal-button";

beforeEach(() => deleteMock.mockReset());

describe("DeleteProposalButton", () => {
  it("is tier-2: requires typing 'delete', and the armed button stays disabled until then", () => {
    renderWithIntl(<DeleteProposalButton proposalId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Delete draft/ }));
    const confirm = screen.getByRole("button", { name: /Delete forever/ });
    expect(confirm).toBeDisabled();
    expect(deleteMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Type delete to confirm/), {
      target: { value: "nope" },
    });
    expect(confirm).toBeDisabled();
  });

  it("deletes with the proposal id once armed", async () => {
    deleteMock.mockResolvedValue({ success: true });
    renderWithIntl(<DeleteProposalButton proposalId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Delete draft/ }));
    fireEvent.change(screen.getByLabelText(/Type delete to confirm/), {
      target: { value: "delete" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Delete forever/ }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    const fd = deleteMock.mock.calls[0]![0] as FormData;
    expect(fd.get("id")).toBe("p1");
  });

  it("cancel backs out without deleting", () => {
    renderWithIntl(<DeleteProposalButton proposalId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Delete draft/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(deleteMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Delete draft/ }),
    ).toBeInTheDocument();
  });

  it("surfaces action failure inline — never a silent no-op", async () => {
    deleteMock.mockResolvedValue({
      success: false,
      error: { message: "Only draft proposals can be deleted." },
    });
    renderWithIntl(<DeleteProposalButton proposalId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Delete draft/ }));
    fireEvent.change(screen.getByLabelText(/Type delete to confirm/), {
      target: { value: "delete" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Delete forever/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Only draft proposals/,
      ),
    );
  });
});
