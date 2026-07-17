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
  it("is two-step: the confirm restates the recipient before anything sends", async () => {
    sendMock.mockResolvedValue({ success: true });
    renderWithIntl(
      <SendProposalButton
        proposalId="prop-1"
        blockers={[]}
        signerEmail="jordan@eyereg.example"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Send for sign-off/ }));
    // Nothing sent yet — the confirm shows exactly who will be emailed.
    expect(sendMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", {
      name: /Send to jordan@eyereg\.example/,
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect((sendMock.mock.calls[0]![0] as FormData).get("id")).toBe("prop-1");
  });

  it("cancel backs out without sending", () => {
    renderWithIntl(
      <SendProposalButton
        proposalId="prop-1"
        blockers={[]}
        signerEmail="jordan@eyereg.example"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Send for sign-off/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(sendMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Send for sign-off/ }),
    ).toBeInTheDocument();
  });

  it("is disabled while blockers remain, with each one listed", () => {
    renderWithIntl(
      <SendProposalButton
        proposalId="prop-1"
        blockers={["Name the proposal", "Choose a signer contact"]}
        signerEmail={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Send for sign-off/ }),
    ).toBeDisabled();
    expect(screen.getByText("Finish these before sending:")).toBeInTheDocument();
    expect(screen.getByText("Name the proposal")).toBeInTheDocument();
    expect(screen.getByText("Choose a signer contact")).toBeInTheDocument();
  });

  it("surfaces action failure inline — never a silent no-op", async () => {
    sendMock.mockResolvedValue({
      success: false,
      error: { message: "Email is not configured for this team." },
    });
    renderWithIntl(
      <SendProposalButton
        proposalId="prop-1"
        blockers={[]}
        signerEmail="jordan@eyereg.example"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Send for sign-off/ }));
    fireEvent.click(screen.getByRole("button", { name: /Send to/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Email is not configured/,
      ),
    );
  });
});
