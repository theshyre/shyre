import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const counterMock = vi.fn();
vi.mock("./actions", () => ({
  counterSignProposalAction: (fd: FormData) => counterMock(fd),
  sendProposalAction: vi.fn(),
}));

import { CounterSignButton } from "./counter-sign-button";

beforeEach(() => counterMock.mockReset());

describe("CounterSignButton", () => {
  it("counter-signs with the proposal id", async () => {
    counterMock.mockResolvedValue({ success: true });
    renderWithIntl(<CounterSignButton proposalId="prop-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Counter-sign/ }));
    await waitFor(() => expect(counterMock).toHaveBeenCalledTimes(1));
    expect((counterMock.mock.calls[0]![0] as FormData).get("id")).toBe(
      "prop-1",
    );
  });

  it("surfaces failure inline", async () => {
    counterMock.mockResolvedValue({
      success: false,
      error: { message: "This acceptance is already counter-signed." },
    });
    renderWithIntl(<CounterSignButton proposalId="prop-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Counter-sign/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/already counter-signed/),
    );
  });
});
