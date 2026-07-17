import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const requestMock = vi.fn();
const verifyMock = vi.fn();
vi.mock("./actions", () => ({
  requestSignOtpAction: (...args: unknown[]) => requestMock(...args),
  verifySignOtpAction: (...args: unknown[]) => verifyMock(...args),
  submitSignDecisionAction: vi.fn(),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { SignGate } from "./sign-gate";
import type { SignGateInfo } from "@/lib/proposals/sign-service";

function info(overrides: Partial<SignGateInfo> = {}): SignGateInfo {
  return {
    verified: false,
    businessName: "Malcom IO",
    businessLogoUrl: null,
    brandColor: null,
    wordmarkPrimary: "malcom",
    wordmarkSecondary: ".io",
    maskedEmail: "jo•••@eyereg.example",
    otpPending: false,
    decided: false,
    signTheme: "light",
    ...overrides,
  };
}

const TOKEN = "tok-raw";

beforeEach(() => {
  requestMock.mockReset();
  verifyMock.mockReset();
  refreshMock.mockReset();
});

describe("SignGate", () => {
  it("shows only the sender brand + masked recipient — no proposal content", () => {
    renderWithIntl(<SignGate token={TOKEN} info={info()} />);
    expect(screen.getByText(/A proposal from Malcom IO is waiting/)).toBeInTheDocument();
    expect(screen.getByText(/jo•••@eyereg\.example/)).toBeInTheDocument();
    // Before requesting, only the "email me a code" affordance exists.
    expect(
      screen.getByRole("button", { name: /Email me a code/ }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/6-digit code/)).not.toBeInTheDocument();
  });

  it("requests a code, then reveals the code field", async () => {
    requestMock.mockResolvedValue({ ok: true });
    renderWithIntl(<SignGate token={TOKEN} info={info()} />);
    fireEvent.click(screen.getByRole("button", { name: /Email me a code/ }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(TOKEN));
    expect(await screen.findByLabelText(/6-digit code/)).toBeInTheDocument();
  });

  it("verifies an entered code and refreshes the page to reveal the document", async () => {
    verifyMock.mockResolvedValue({ ok: true });
    renderWithIntl(<SignGate token={TOKEN} info={info({ otpPending: true })} />);
    const field = screen.getByLabelText(/6-digit code/);
    fireEvent.change(field, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /^Verify$/ }));
    await waitFor(() => expect(verifyMock).toHaveBeenCalledWith(TOKEN, "123456"));
    // On success the action set the cookie server-side; the page must refresh
    // so it re-renders past the gate.
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("surfaces a wrong-code error and does not refresh", async () => {
    verifyMock.mockResolvedValue({ ok: false, reason: "otp_invalid" });
    renderWithIntl(<SignGate token={TOKEN} info={info({ otpPending: true })} />);
    fireEvent.change(screen.getByLabelText(/6-digit code/), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Verify$/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/isn't right/),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("shows a terminal message (no OTP form) once the link is decided", () => {
    renderWithIntl(<SignGate token={TOKEN} info={info({ decided: true })} />);
    expect(
      screen.getByText(/A decision has already been recorded/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Email me a code/ }),
    ).not.toBeInTheDocument();
  });
});
