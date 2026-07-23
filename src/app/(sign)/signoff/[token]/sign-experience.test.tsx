import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const submitMock = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock("./actions", () => ({
  submitSignoffDecisionAction: (...a: unknown[]) => submitMock(...a),
}));
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { SignoffSignExperience } from "./sign-experience";
import type { SignBundle } from "@/lib/sign/signoff-sign-service";

const bundle: SignBundle = {
  documentId: "doc-1",
  title: "Release Notes v2.0.2",
  versionLabel: "v2.0.2",
  bodyMarkdown: "# Notes\n\nBody text.",
  signTheme: "light",
  signerName: "Bret Andre",
  signerRole: "Principal Consultant",
  signerOrg: "EyeReg",
  decided: false,
  decision: null,
  businessName: "Malcom IO",
  businessLogoUrl: null,
  brandColor: null,
  wordmarkPrimary: null,
  wordmarkSecondary: null,
  customerName: null,
  customerLogoUrl: null,
};

beforeEach(() => {
  submitMock.mockReset().mockResolvedValue({ ok: true });
  refreshMock.mockClear();
});

describe("SignoffSignExperience", () => {
  it("renders the document + prefilled signer, and gates Sign on name+signature+attestation", () => {
    renderWithIntl(<SignoffSignExperience token="t1" bundle={bundle} />);
    expect(screen.getByText("Release Notes v2.0.2")).toBeInTheDocument();
    expect(screen.getByText("Body text.")).toBeInTheDocument();
    const sign = screen.getByRole("button", { name: /^Sign$/ });
    // Name is prefilled, but no signature + no attestation → disabled.
    expect(sign).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Signature/), { target: { value: "Bret Andre" } });
    expect(sign).toBeDisabled(); // still needs the attestation
    fireEvent.click(screen.getByRole("checkbox"));
    expect(sign).toBeEnabled();
  });

  it("submits a signed decision with the chosen meaning", async () => {
    renderWithIntl(<SignoffSignExperience token="t1" bundle={bundle} />);
    fireEvent.change(screen.getByLabelText(/Signature/), { target: { value: "Bret Andre" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /^Sign$/ }));
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock.mock.calls[0]![1]).toMatchObject({
      decision: "signed",
      signerName: "Bret Andre",
      signatureMeaning: "approver",
    });
  });

  it("allows declining without a signature", async () => {
    renderWithIntl(<SignoffSignExperience token="t1" bundle={bundle} />);
    fireEvent.click(screen.getByRole("button", { name: /Decline/ }));
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock.mock.calls[0]![1]).toMatchObject({ decision: "declined" });
  });

  it("shows the terminal banner once decided", () => {
    renderWithIntl(
      <SignoffSignExperience token="t1" bundle={{ ...bundle, decided: true, decision: "signed" }} />,
    );
    expect(screen.getByText(/your signature has been recorded/i)).toBeInTheDocument();
  });
});
