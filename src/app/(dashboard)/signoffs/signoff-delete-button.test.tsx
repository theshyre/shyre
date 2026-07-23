import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const deleteMock = vi.fn(async (..._a: unknown[]) => ({ success: true as const }));
vi.mock("./actions", () => ({
  deleteSignoffAction: (...a: unknown[]) => deleteMock(...a),
}));

import { SignoffDeleteButton } from "./signoff-delete-button";

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  deleteMock.mockReset().mockResolvedValue({ success: true });
});

function openConfirm(): void {
  fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
}

describe("SignoffDeleteButton (tier-2 typed-delete)", () => {
  it("requires typing 'delete' before the confirm button arms", () => {
    renderWithIntl(<SignoffDeleteButton documentId="s1" />);
    openConfirm();
    const confirm = screen.getByRole("button", { name: /^Delete$/ });
    // Armed only once the word is typed.
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type delete to confirm/i), {
      target: { value: "delete" },
    });
    expect(confirm).toBeEnabled();
  });

  it("deletes and navigates to the list once armed", async () => {
    renderWithIntl(<SignoffDeleteButton documentId="s1" />);
    openConfirm();
    fireEvent.change(screen.getByLabelText(/Type delete to confirm/i), {
      target: { value: "delete" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith("/signoffs");
  });

  it("surfaces a failure inline without navigating", async () => {
    deleteMock.mockRejectedValue(new Error("A sent sign-off is part of the audit record"));
    renderWithIntl(<SignoffDeleteButton documentId="s1" />);
    openConfirm();
    fireEvent.change(screen.getByLabelText(/Type delete to confirm/i), {
      target: { value: "delete" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/audit record/i),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("cancel backs out", () => {
    renderWithIntl(<SignoffDeleteButton documentId="s1" />);
    openConfirm();
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(screen.queryByLabelText(/Type delete to confirm/i)).not.toBeInTheDocument();
  });
});
