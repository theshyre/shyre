import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const requestMock = vi.fn();
const verifyMock = vi.fn();
const submitMock = vi.fn();
vi.mock("./actions", () => ({
  requestSignOtpAction: (...args: unknown[]) => requestMock(...args),
  verifySignOtpAction: (...args: unknown[]) => verifyMock(...args),
  submitSignDecisionAction: (...args: unknown[]) => submitMock(...args),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { SignExperience } from "./sign-experience";
import type { SignBundle } from "@/lib/proposals/sign-service";

function bundle(overrides: Partial<SignBundle> = {}): SignBundle {
  return {
    proposal: {
      proposalNumber: "PROP-2026-001",
      title: "Modernization",
      status: "viewed",
      issuedDate: "2026-07-16",
      validUntil: "2026-08-15",
      paymentTermsLabel: "Net 30",
      depositType: "percent",
      depositValue: 25,
      warrantyDays: 30,
      termsNotes: null,
      currency: "USD",
      acceptedTotal: null,
    },
    items: [
      {
        id: "li-1",
        title: "Basic dependency upgrades",        summary: null,
        bodyMarkdown: null,
        description: null,
        whyItMatters: null,
        outOfScope: null,
        definitionOfDone: null,
        fixedPrice: 950,
        isCapped: false,
        pricingType: "fixed_bid",
        hourlyRate: null,
        estimateLow: null,
        estimateHigh: null,
        phases: [],
      },
      {
        id: "li-2",
        title: "Modernize underlying components",        summary: null,
        bodyMarkdown: null,
        description: null,
        whyItMatters: null,
        outOfScope: null,
        definitionOfDone: null,
        fixedPrice: 4000,
        isCapped: true,
        pricingType: "fixed_bid",
        hourlyRate: null,
        estimateLow: null,
        estimateHigh: null,
        phases: [
          { title: "Update the visual framework", description: null, fixedPrice: 2200 },
          { title: "Retire older libraries", description: null, fixedPrice: 1200 },
          { title: "Refresh code-quality checks", description: null, fixedPrice: 600 },
        ],
      },
    ],
    businessName: "Malcom IO",
    businessLogoUrl: null,
    brandColor: null,
    wordmarkPrimary: null,
    wordmarkSecondary: null,
    signTheme: "light",
    customerName: "EyeReg",
    customerLogoUrl: null,
    customerAccentColor: null,
    signingMode: "first",
    boundSelectedIds: null,
    awaitingPrimary: false,
    overviewMarkdown: null,
    signerEmail: "jordan@eyereg.example",
    otpVerified: true,
    otpPending: false,
    decided: false,
    offerExpired: false,
    ...overrides,
  };
}

beforeEach(() => {
  requestMock.mockReset();
  verifyMock.mockReset();
  submitMock.mockReset();
  refreshMock.mockReset();
});

describe("SignExperience", () => {
  it("renders the document with items, phases, and the full total", () => {
    renderWithIntl(<SignExperience token="tok" bundle={bundle()} />);
    expect(screen.getByText("Modernization")).toBeInTheDocument();
    // Item titles/prices also render in the auto summary table above the items.
    expect(
      screen.getAllByText("Basic dependency upgrades").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("$4,950.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Update the visual framework")).toBeInTheDocument();
    // Terms line is composed of multiple text nodes — match on the list item.
    expect(screen.getByText(/Net 30/)).toBeInTheDocument();
  });



  it("verified state: subset selection drives the accept total, accept submits the ids", async () => {
    submitMock.mockResolvedValue({ ok: true });
    renderWithIntl(
      <SignExperience token="tok" bundle={bundle({ otpVerified: true })} />,
    );

    // Both selected → accept shows $4,950.
    expect(
      screen.getByRole("button", { name: /Accept — \$4,950\.00/ }),
    ).toBeInTheDocument();

    // Uncheck item 2 → accept shows $950.
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    const acceptBtn = screen.getByRole("button", { name: /Accept — \$950\.00/ });

    // Accept requires name + signature.
    expect(acceptBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Jordan Chen" },
    });
    fireEvent.change(screen.getByLabelText("Signature"), {
      target: { value: "Jordan Chen" },
    });
    expect(acceptBtn).toBeEnabled();

    fireEvent.click(acceptBtn);
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock).toHaveBeenCalledWith("tok", {
      decision: "accepted",
      signerName: "Jordan Chen",
      signerTitle: "",
      signatureTyped: "Jordan Chen",
      selectedLineItemIds: ["li-1"],
    });
  });

  it("decline is two-step and needs a name but no signature", async () => {
    submitMock.mockResolvedValue({ ok: true });
    renderWithIntl(
      <SignExperience token="tok" bundle={bundle({ otpVerified: true })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Decline$/ }));
    expect(submitMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Jordan Chen" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm decline/ }));
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock.mock.calls[0]![1]).toMatchObject({
      decision: "declined",
      selectedLineItemIds: [],
    });
  });

  it("decided state shows the banner and no sign controls", () => {
    renderWithIntl(
      <SignExperience
        token="tok"
        bundle={bundle({
          decided: true,
          otpVerified: true,
          proposal: { ...bundle().proposal, status: "accepted", acceptedTotal: 4950 },
        })}
      />,
    );
    expect(
      screen.getByText(/was accepted — total \$4,950\.00/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Accept/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("expired offer: warning shown, accept hidden, decline still available", () => {
    renderWithIntl(
      <SignExperience
        token="tok"
        bundle={bundle({ otpVerified: true, offerExpired: true })}
      />,
    );
    expect(screen.getByText(/validity window ended/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Accept/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Decline$/ })).toBeInTheDocument();
  });

  it("keeps the persistent polite live region mounted from first render", () => {
    // OTP announcements moved to the SignGate (which owns verification now);
    // this component still announces decisions through the same region.
    renderWithIntl(
      <SignExperience token="tok" bundle={bundle({ otpVerified: true })} />,
    );
    const region = screen
      .getAllByRole("status")
      .find((el) => el.getAttribute("aria-live") === "polite");
    expect(region).toBeDefined();
    expect(region!.textContent).toBe("");
  });
});
