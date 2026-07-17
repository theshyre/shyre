import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const versionMock = vi.fn();
vi.mock("./actions", () => ({
  createProposalVersionAction: (fd: FormData) => versionMock(fd),
}));

import { NewVersionButton } from "./new-version-button";

beforeEach(() => versionMock.mockReset());

describe("NewVersionButton", () => {
  it("creates a version with the proposal id", async () => {
    versionMock.mockResolvedValue({ success: true });
    renderWithIntl(<NewVersionButton proposalId="prop-1" />);
    fireEvent.click(screen.getByRole("button", { name: /New version/ }));
    await waitFor(() => expect(versionMock).toHaveBeenCalledTimes(1));
    expect((versionMock.mock.calls[0]![0] as FormData).get("id")).toBe(
      "prop-1",
    );
  });

  it("surfaces failure inline", async () => {
    versionMock.mockResolvedValue({
      success: false,
      error: { message: "Signed proposals can't be revised." },
    });
    renderWithIntl(<NewVersionButton proposalId="prop-1" />);
    fireEvent.click(screen.getByRole("button", { name: /New version/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/can't be revised/),
    );
  });
});
