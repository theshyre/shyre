import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const sendMock = vi.fn();
vi.mock("./actions", () => ({
  sendProposalAction: (fd: FormData) => sendMock(fd),
  counterSignProposalAction: vi.fn(),
}));

import { SendProposalButton } from "./send-proposal-button";

beforeEach(() => sendMock.mockReset());

describe("SendProposalButton", () => {
  it("sends with the proposal id", async () => {
    sendMock.mockResolvedValue({ success: true });
    renderWithIntl(<SendProposalButton proposalId="prop-1" hasSigner />);
    fireEvent.click(screen.getByRole("button", { name: /Send for sign-off/ }));
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect((sendMock.mock.calls[0]![0] as FormData).get("id")).toBe("prop-1");
  });

  it("is disabled without a signer, with the reason visible", () => {
    renderWithIntl(<SendProposalButton proposalId="prop-1" hasSigner={false} />);
    expect(
      screen.getByRole("button", { name: /Send for sign-off/ }),
    ).toBeDisabled();
    expect(
      screen.getByText("Add a signer contact to send"),
    ).toBeInTheDocument();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("surfaces action failure inline — never a silent no-op", async () => {
    sendMock.mockResolvedValue({
      success: false,
      error: { message: "Email is not configured for this team." },
    });
    renderWithIntl(<SendProposalButton proposalId="prop-1" hasSigner />);
    fireEvent.click(screen.getByRole("button", { name: /Send for sign-off/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Email is not configured/,
      ),
    );
  });
});
