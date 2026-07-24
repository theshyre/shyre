import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const markDelivered = vi.fn();
const reopen = vi.fn();
vi.mock("./actions", () => ({
  markProposalDeliveredAction: (fd: FormData) => markDelivered(fd),
  reopenProposalDeliveryAction: (fd: FormData) => reopen(fd),
}));

const push = vi.fn();
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ push }),
}));

import { ProposalLifecycleActions } from "./proposal-lifecycle-actions";

function props(
  overrides: Partial<
    React.ComponentProps<typeof ProposalLifecycleActions>
  > = {},
): React.ComponentProps<typeof ProposalLifecycleActions> {
  return {
    proposalId: "prop-1",
    delivered: false,
    deliveryReady: false,
    deliveredCount: 0,
    deliveredTotal: 3,
    isAdmin: true,
    ...overrides,
  };
}

beforeEach(() => {
  markDelivered.mockReset();
  reopen.mockReset();
  push.mockReset();
});

describe("ProposalLifecycleActions", () => {
  it("renders nothing for a non-admin", () => {
    const { container } = renderWithIntl(
      <ProposalLifecycleActions {...props({ isAdmin: false })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a Mark delivered button on an undelivered engagement", () => {
    renderWithIntl(<ProposalLifecycleActions {...props()} />);
    expect(
      screen.getByRole("button", { name: /^mark delivered$/i }),
    ).toBeInTheDocument();
  });

  it("shows a Reopen button once delivered", () => {
    renderWithIntl(
      <ProposalLifecycleActions {...props({ delivered: true })} />,
    );
    expect(screen.getByRole("button", { name: /reopen/i })).toBeInTheDocument();
  });

  it("arms a confirm with the ready nudge when every phase is closed out", () => {
    renderWithIntl(
      <ProposalLifecycleActions
        {...props({ deliveryReady: true, deliveredCount: 3, deliveredTotal: 3 })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^mark delivered$/i }));
    expect(
      screen.getByText(/all 3 phases are closed out/i),
    ).toBeInTheDocument();
  });

  it("arms a confirm with a partial caveat when phases are still open", () => {
    renderWithIntl(
      <ProposalLifecycleActions
        {...props({ deliveryReady: false, deliveredCount: 2, deliveredTotal: 3 })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^mark delivered$/i }));
    expect(
      screen.getByText(/2 of 3 phases closed out/i),
    ).toBeInTheDocument();
  });

  it("marks delivered and pushes a success toast with an Undo", async () => {
    markDelivered.mockResolvedValue({ success: true });
    renderWithIntl(<ProposalLifecycleActions {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /^mark delivered$/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /mark this engagement delivered/i }),
    );
    await waitFor(() => expect(markDelivered).toHaveBeenCalled());
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "success",
          actionLabel: expect.anything(),
        }),
      ),
    );
  });

  it("surfaces the error envelope's message when delivery fails", async () => {
    markDelivered.mockResolvedValue({
      success: false,
      error: { message: "nope" },
    });
    renderWithIntl(<ProposalLifecycleActions {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /^mark delivered$/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /mark this engagement delivered/i }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "error", message: "nope" }),
      ),
    );
  });

  it("reopens and pushes a success toast", async () => {
    reopen.mockResolvedValue({ success: true });
    renderWithIntl(
      <ProposalLifecycleActions {...props({ delivered: true })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));
    await waitFor(() => expect(reopen).toHaveBeenCalled());
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "success" }),
      ),
    );
  });
});
