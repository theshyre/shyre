import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithIntl } from "@/test/intl";
import { ToastProvider } from "@/components/Toast";

const sendMock = vi.fn();
vi.mock("./actions", () => ({
  sendProposalAction: (fd: FormData) => sendMock(fd),
  counterSignProposalAction: vi.fn(),
}));

import { SendProposalButton } from "./send-proposal-button";

/** The button calls `useToast()`, so it needs a ToastProvider ancestor. */
function render(ui: ReactElement): RenderResult {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

function openConfirm(): void {
  fireEvent.click(screen.getByRole("button", { name: /Send for sign-off/ }));
}

beforeEach(() => sendMock.mockReset());

describe("SendProposalButton", () => {
  it("lists EVERY signer in the confirm for a multi-signer proposal", () => {
    render(
      <SendProposalButton
        proposalId="prop-1"
        blockers={[]}
        recipients={[
          { name: "Bret Andre", email: "bret@avdresearch.com" },
          { name: "Mijeong Andre", email: "mj@avdresearch.com" },
        ]}
      />,
    );
    openConfirm();
    const dialog = screen.getByRole("dialog");
    // Both signers + emails are shown, and it's clear each gets their own link.
    expect(dialog).toHaveTextContent("Bret Andre");
    expect(dialog).toHaveTextContent("bret@avdresearch.com");
    expect(dialog).toHaveTextContent("Mijeong Andre");
    expect(dialog).toHaveTextContent("mj@avdresearch.com");
    expect(dialog).toHaveTextContent(/To 2 signers/);
    expect(dialog).toHaveTextContent(/own private link and one-time code/);
  });

  it("opens a confirm dialog that restates the recipient before anything sends", async () => {
    sendMock.mockResolvedValue({ success: true });
    render(
      <SendProposalButton
        proposalId="prop-1"
        blockers={[]}
        recipients={[{ name: "Jordan Chen", email: "jordan@eyereg.example" }]}
      />,
    );
    openConfirm();

    // A dialog opens; nothing has been sent yet.
    const dialog = screen.getByRole("dialog");
    expect(sendMock).not.toHaveBeenCalled();
    // The recipient is visible text in the panel (not just a tooltip),
    // and the freeze consequence is spelled out.
    expect(dialog).toHaveTextContent("jordan@eyereg.example");
    expect(dialog).toHaveTextContent(/freezes this draft/i);

    fireEvent.click(
      screen.getByRole("button", { name: /Send now to jordan@eyereg\.example/ }),
    );
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect((sendMock.mock.calls[0]![0] as FormData).get("id")).toBe("prop-1");
  });

  it("announces success via a toast once sent", async () => {
    sendMock.mockResolvedValue({ success: true });
    render(
      <SendProposalButton
        proposalId="prop-1"
        blockers={[]}
        recipients={[{ name: "Jordan Chen", email: "jordan@eyereg.example" }]}
      />,
    );
    openConfirm();
    fireEvent.click(screen.getByRole("button", { name: /Send now to/ }));
    await waitFor(() =>
      expect(
        screen.getByText(/Proposal sent to jordan@eyereg\.example/),
      ).toBeInTheDocument(),
    );
  });

  it("cancel backs out without sending", () => {
    render(
      <SendProposalButton
        proposalId="prop-1"
        blockers={[]}
        recipients={[{ name: "Jordan Chen", email: "jordan@eyereg.example" }]}
      />,
    );
    openConfirm();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(sendMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Send for sign-off/ }),
    ).toBeInTheDocument();
  });

  it("Escape closes the confirm without sending", () => {
    render(
      <SendProposalButton
        proposalId="prop-1"
        blockers={[]}
        recipients={[{ name: "Jordan Chen", email: "jordan@eyereg.example" }]}
      />,
    );
    openConfirm();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("when blockers remain, the trigger stays usable and opens a checklist instead of sending", () => {
    render(
      <SendProposalButton
        proposalId="prop-1"
        blockers={["Name the proposal", "Choose a signer contact"]}
        recipients={[]}
      />,
    );
    // The trigger is NOT a dead disabled button — it opens a panel that
    // explains what's missing (keyboard/SR reachable, unlike a tooltip
    // on a disabled control).
    const trigger = screen.getByRole("button", { name: /Send for sign-off/ });
    expect(trigger).not.toBeDisabled();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Finish these before sending:");
    expect(dialog).toHaveTextContent("Name the proposal");
    expect(dialog).toHaveTextContent("Choose a signer contact");
    // No recipient-bearing confirm exists in this state; nothing can send.
    expect(
      screen.queryByRole("button", { name: /Send now to/ }),
    ).not.toBeInTheDocument();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("surfaces action failure inline — never a silent no-op", async () => {
    sendMock.mockResolvedValue({
      success: false,
      error: { message: "Email is not configured for this team." },
    });
    render(
      <SendProposalButton
        proposalId="prop-1"
        blockers={[]}
        recipients={[{ name: "Jordan Chen", email: "jordan@eyereg.example" }]}
      />,
    );
    openConfirm();
    fireEvent.click(screen.getByRole("button", { name: /Send now to/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Email is not configured/,
      ),
    );
  });
});
