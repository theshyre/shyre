import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const sendMock = vi.fn(async (..._a: unknown[]) => ({ success: true as const }));
const cancelMock = vi.fn(async (..._a: unknown[]) => ({ success: true as const }));
vi.mock("./actions", () => ({
  sendSignoffAction: (...a: unknown[]) => sendMock(...a),
  cancelSignoffAction: (...a: unknown[]) => cancelMock(...a),
}));
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { SignoffSendButton, SignoffCancelButton } from "./signoff-send-buttons";

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ success: true });
  cancelMock.mockReset().mockResolvedValue({ success: true });
  refreshMock.mockClear();
});

describe("SignoffSendButton", () => {
  it("is disabled until the sign-off is send-ready", () => {
    renderWithIntl(<SignoffSendButton documentId="d1" ready={false} />);
    expect(screen.getByRole("button", { name: /^Send$/ })).toBeDisabled();
  });

  it("confirms then sends", async () => {
    renderWithIntl(<SignoffSendButton documentId="d1" ready />);
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    expect(sendMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Send for signature/ }));
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect(refreshMock).toHaveBeenCalled();
  });
});

describe("SignoffCancelButton", () => {
  it("confirms then cancels", async () => {
    renderWithIntl(<SignoffCancelButton documentId="d1" />);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel sign-off/ }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(1));
  });
});
