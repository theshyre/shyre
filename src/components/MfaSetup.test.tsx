import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

/**
 * Audit batch D coverage for MfaSetup: translated pending states
 * (no more literal "..."), role="alert" on async errors, the QR
 * code hidden from assistive tech (WCAG 1.1.1 — the secret-key
 * fallback is the accessible enrollment path), and the destructive
 * confirm() prompts carrying translated copy. Pre-existing enroll/
 * verify/disable business logic is exercised only as needed to reach
 * these states — this file didn't exist before the audit pass.
 */

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <svg data-testid="qr-svg" data-value={value} />
  ),
}));

const listFactors = vi.fn();
const enroll = vi.fn();
const challenge = vi.fn();
const verify = vi.fn();
const unenroll = vi.fn();
const getUser = vi.fn();

// Number of unused backup-code rows `checkStatus`'s count query returns.
// Mutable per-test so the plural-copy assertion can exercise a
// non-zero count.
let backupCodeRowCount = 0;

function makeFromChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    select: () => chain,
    is: () =>
      Promise.resolve({
        data: Array.from({ length: backupCodeRowCount }, (_, i) => ({
          id: `code-${i}`,
        })),
        error: null,
      }),
    delete: () => chain,
    eq: () => Promise.resolve({ data: null, error: null }),
    insert: () => Promise.resolve({ data: null, error: null }),
  };
  return chain;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      mfa: { listFactors, enroll, challenge, verify, unenroll },
      getUser,
    },
    from: () => makeFromChain(),
  }),
}));

import { MfaSetup } from "./MfaSetup";

beforeEach(() => {
  vi.clearAllMocks();
  backupCodeRowCount = 0;
  listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null });
  getUser.mockResolvedValue({
    data: { user: { id: "u-1", email: "user@example.com" } },
  });
});

describe("MfaSetup", () => {
  it("shows a translated loading state while checking MFA status, then the disabled idle state", async () => {
    renderWithIntl(<MfaSetup />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("MFA Disabled")).toBeInTheDocument(),
    );
  });

  it("clicking Enable shows the translated 'Enrolling…' pending label, then the QR is hidden from assistive tech", async () => {
    let resolveEnroll: (v: unknown) => void = () => {};
    enroll.mockReturnValue(
      new Promise((res) => {
        resolveEnroll = res;
      }),
    );
    renderWithIntl(<MfaSetup />);
    await waitFor(() => screen.getByText("MFA Disabled"));

    fireEvent.click(screen.getByRole("button", { name: /Enable MFA/ }));
    expect(await screen.findByText("Enrolling…")).toBeInTheDocument();

    resolveEnroll({
      data: {
        id: "factor-1",
        totp: { uri: "otpauth://totp/x?secret=ABC", secret: "ABC" },
      },
      error: null,
    });

    await waitFor(() =>
      expect(screen.getByText("Set Up MFA")).toBeInTheDocument(),
    );
    // WCAG 1.1.1 — the QR is a visual-only shortcut; the secret-key
    // fallback right below it is the accessible enrollment path.
    const qrWrapper = screen.getByTestId("qr-svg").parentElement;
    expect(qrWrapper).toHaveAttribute("aria-hidden", "true");
  });

  it("an enroll failure renders the error in a role=alert region, not a silent no-op", async () => {
    enroll.mockResolvedValue({
      data: null,
      error: { message: "Enrollment failed" },
    });
    renderWithIntl(<MfaSetup />);
    await waitFor(() => screen.getByText("MFA Disabled"));

    fireEvent.click(screen.getByRole("button", { name: /Enable MFA/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Enrollment failed");
  });

  it("verify pending shows the translated 'Verifying…' label and a code-length gate", async () => {
    enroll.mockResolvedValue({
      data: {
        id: "factor-1",
        totp: { uri: "otpauth://totp/x?secret=ABC", secret: "ABC" },
      },
      error: null,
    });
    let resolveChallenge: (v: unknown) => void = () => {};
    challenge.mockReturnValue(
      new Promise((res) => {
        resolveChallenge = res;
      }),
    );
    // Verify resolves cleanly once the challenge promise (below) settles —
    // the test only asserts the pending label, but the component's own
    // async chain keeps running in the background after that assertion,
    // so this must not be left undefined (an un-mocked vi.fn() resolves
    // to `undefined`, which crashes the destructure a few lines later).
    verify.mockResolvedValue({ error: null });

    renderWithIntl(<MfaSetup />);
    await waitFor(() => screen.getByText("MFA Disabled"));
    fireEvent.click(screen.getByRole("button", { name: /Enable MFA/ }));
    await waitFor(() => screen.getByText("Set Up MFA"));

    const verifyButton = screen.getByRole("button", { name: /Verify/ });
    expect(verifyButton).toBeDisabled();

    const codeInput = screen.getByLabelText(/Enter the 6-digit code/);
    fireEvent.change(codeInput, { target: { value: "123456" } });
    expect(verifyButton).toBeEnabled();

    fireEvent.click(verifyButton);
    expect(await screen.findByText("Verifying…")).toBeInTheDocument();
    resolveChallenge({ data: { id: "chal-1" }, error: null });
  });

  it("a verify failure surfaces via role=alert", async () => {
    enroll.mockResolvedValue({
      data: {
        id: "factor-1",
        totp: { uri: "otpauth://totp/x?secret=ABC", secret: "ABC" },
      },
      error: null,
    });
    challenge.mockResolvedValue({ data: { id: "chal-1" }, error: null });
    verify.mockResolvedValue({ error: { message: "Invalid code" } });

    renderWithIntl(<MfaSetup />);
    await waitFor(() => screen.getByText("MFA Disabled"));
    fireEvent.click(screen.getByRole("button", { name: /Enable MFA/ }));
    await waitFor(() => screen.getByText("Set Up MFA"));

    const codeInput = screen.getByLabelText(/Enter the 6-digit code/);
    fireEvent.change(codeInput, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid code");
  });

  it("shows the enabled state with the pluralized backup-codes-remaining count", async () => {
    listFactors.mockResolvedValue({
      data: {
        totp: [{ id: "factor-1", status: "verified" }],
        all: [{ id: "factor-1", status: "verified" }],
      },
      error: null,
    });
    backupCodeRowCount = 2;
    renderWithIntl(<MfaSetup />);
    await waitFor(() =>
      expect(screen.getByText("MFA Enabled")).toBeInTheDocument(),
    );
    expect(screen.getByText("2 backup codes remaining")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Regenerate Backup Codes/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Disable MFA/ }),
    ).toBeInTheDocument();
  });

  it("renders the singular form when exactly one backup code remains", async () => {
    listFactors.mockResolvedValue({
      data: {
        totp: [{ id: "factor-1", status: "verified" }],
        all: [{ id: "factor-1", status: "verified" }],
      },
      error: null,
    });
    backupCodeRowCount = 1;
    renderWithIntl(<MfaSetup />);
    await waitFor(() =>
      expect(screen.getByText("MFA Enabled")).toBeInTheDocument(),
    );
    expect(screen.getByText("1 backup code remaining")).toBeInTheDocument();
  });

  it("Disable MFA asks a translated confirm() prompt and does nothing when cancelled", async () => {
    listFactors.mockResolvedValue({
      data: {
        totp: [{ id: "factor-1", status: "verified" }],
        all: [{ id: "factor-1", status: "verified" }],
      },
      error: null,
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithIntl(<MfaSetup />);
    await waitFor(() => screen.getByText("MFA Enabled"));

    fireEvent.click(screen.getByRole("button", { name: /Disable MFA/ }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Disable MFA? This will remove the second factor and all backup codes.",
    );
    expect(unenroll).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("confirming Disable shows the translated 'Disabling…' pending label and completes", async () => {
    listFactors.mockResolvedValue({
      data: {
        totp: [{ id: "factor-1", status: "verified" }],
        all: [{ id: "factor-1", status: "verified" }],
      },
      error: null,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let resolveUnenroll: (v: unknown) => void = () => {};
    unenroll.mockReturnValue(
      new Promise((res) => {
        resolveUnenroll = res;
      }),
    );

    renderWithIntl(<MfaSetup />);
    await waitFor(() => screen.getByText("MFA Enabled"));
    fireEvent.click(screen.getByRole("button", { name: /Disable MFA/ }));

    expect(await screen.findByText("Disabling…")).toBeInTheDocument();
    resolveUnenroll({ error: null });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("Regenerate backup codes asks a translated confirm() prompt", async () => {
    listFactors.mockResolvedValue({
      data: {
        totp: [{ id: "factor-1", status: "verified" }],
        all: [{ id: "factor-1", status: "verified" }],
      },
      error: null,
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithIntl(<MfaSetup />);
    await waitFor(() => screen.getByText("MFA Enabled"));

    fireEvent.click(
      screen.getByRole("button", { name: /Regenerate Backup Codes/ }),
    );

    expect(confirmSpy).toHaveBeenCalledWith(
      "Regenerate backup codes? This will invalidate all existing codes.",
    );
    confirmSpy.mockRestore();
  });

  it("Cancel during verification uses the shared common.actions.cancel copy", async () => {
    enroll.mockResolvedValue({
      data: {
        id: "factor-1",
        totp: { uri: "otpauth://totp/x?secret=ABC", secret: "ABC" },
      },
      error: null,
    });
    unenroll.mockResolvedValue({ error: null });
    renderWithIntl(<MfaSetup />);
    await waitFor(() => screen.getByText("MFA Disabled"));
    fireEvent.click(screen.getByRole("button", { name: /Enable MFA/ }));
    await waitFor(() => screen.getByText("Set Up MFA"));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.getByText("MFA Disabled")).toBeInTheDocument(),
    );
  });
});
