import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const requestMock = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const verifyMock = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock("./actions", () => ({
  requestSignoffOtpAction: (...a: unknown[]) => requestMock(...a),
  verifySignoffOtpAction: (...a: unknown[]) => verifyMock(...a),
}));
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { SignoffSignGate } from "./sign-gate";
import type { SignGateInfo } from "@/lib/sign/signoff-sign-service";

const info: SignGateInfo = {
  verified: false,
  businessName: "Malcom IO",
  businessLogoUrl: null,
  brandColor: null,
  wordmarkPrimary: null,
  wordmarkSecondary: null,
  maskedEmail: "br•••@fdapproval.com",
  otpPending: false,
  decided: false,
  signTheme: "light",
};

beforeEach(() => {
  requestMock.mockReset().mockResolvedValue({ ok: true });
  verifyMock.mockReset().mockResolvedValue({ ok: true });
  refreshMock.mockClear();
});

describe("SignoffSignGate", () => {
  it("shows the masked email and emails a code, advancing to the code step", async () => {
    renderWithIntl(<SignoffSignGate token="t1" info={info} />);
    expect(screen.getByText(/br•••@fdapproval\.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Email me a code/ }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("t1"));
    expect(await screen.findByLabelText(/Enter the 6-digit code/)).toBeInTheDocument();
  });

  it("verifies a 6-digit code and refreshes", async () => {
    renderWithIntl(<SignoffSignGate token="t1" info={{ ...info, otpPending: true }} />);
    fireEvent.change(screen.getByLabelText(/Enter the 6-digit code/), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Verify$/ }));
    await waitFor(() => expect(verifyMock).toHaveBeenCalledWith("t1", "123456"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows a terminal message when the link is already decided", () => {
    renderWithIntl(<SignoffSignGate token="t1" info={{ ...info, decided: true }} />);
    expect(screen.getByText(/already recorded your decision/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Email me a code/ })).not.toBeInTheDocument();
  });
});
