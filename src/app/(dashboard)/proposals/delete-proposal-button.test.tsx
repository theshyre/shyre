import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const deleteMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./actions", () => ({
  deleteProposalAction: (fd: FormData) => deleteMock(fd),
}));

import { DeleteProposalButton } from "./delete-proposal-button";

beforeEach(() => deleteMock.mockClear());

describe("DeleteProposalButton", () => {
  it("does not delete on first click — asks for inline confirmation", () => {
    renderWithIntl(<DeleteProposalButton proposalId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Delete draft/ }));
    expect(deleteMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Confirm delete/ }),
    ).toBeInTheDocument();
  });

  it("deletes with the proposal id on confirm", async () => {
    renderWithIntl(<DeleteProposalButton proposalId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Delete draft/ }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm delete/ }));
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
});
