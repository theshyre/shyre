import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const deleteMock = vi.fn();
vi.mock("./actions", () => ({
  deleteSignoffAction: (...a: unknown[]) => deleteMock(...a),
}));

import { SignoffDeleteButton } from "./signoff-delete-button";

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  deleteMock.mockReset();
});

describe("SignoffDeleteButton", () => {
  it("requires an inline confirm before deleting, then navigates on success", async () => {
    deleteMock.mockResolvedValue({ success: true });
    renderWithIntl(<SignoffDeleteButton documentId="s1" />);

    // First click reveals the confirm; no action yet.
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(deleteMock).not.toHaveBeenCalled();

    // Confirm fires the action and navigates to the list.
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith("/signoffs");
  });

  it("surfaces a failure message and does not navigate", async () => {
    deleteMock.mockResolvedValue({ success: false, error: { userMessageKey: "x" } });
    renderWithIntl(<SignoffDeleteButton documentId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() =>
      expect(screen.getByText(/Couldn't delete/i)).toBeInTheDocument(),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("cancel backs out of the confirm", () => {
    renderWithIntl(<SignoffDeleteButton documentId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
