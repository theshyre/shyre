import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const convertMock = vi.fn();
vi.mock("./actions", () => ({
  convertProposalAction: (fd: FormData) => convertMock(fd),
}));

import { ConvertProposalButton } from "./convert-proposal-button";

beforeEach(() => convertMock.mockReset());

describe("ConvertProposalButton", () => {
  it("converts with the proposal id", async () => {
    convertMock.mockResolvedValue({ success: true });
    renderWithIntl(<ConvertProposalButton proposalId="prop-1" />);
    fireEvent.click(
      screen.getByRole("button", { name: /Convert to projects/ }),
    );
    await waitFor(() => expect(convertMock).toHaveBeenCalledTimes(1));
    expect((convertMock.mock.calls[0]![0] as FormData).get("id")).toBe(
      "prop-1",
    );
  });

  it("surfaces failure inline", async () => {
    convertMock.mockResolvedValue({
      success: false,
      error: { message: "Every accepted line item has already been converted." },
    });
    renderWithIntl(<ConvertProposalButton proposalId="prop-1" />);
    fireEvent.click(
      screen.getByRole("button", { name: /Convert to projects/ }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/already been converted/),
    );
  });
});
