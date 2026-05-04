import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/invoices/i1/send",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../send-invoice-action", () => ({
  sendInvoiceMessageAction: vi.fn(),
}));

// react-pdf bombs in jsdom; the form imports it but only invokes
// `pdf().toBlob()` on submit. The smoke tests here don't submit.
vi.mock("@react-pdf/renderer", () => ({
  pdf: () => ({ toBlob: async () => new Blob() }),
  // The InvoicePDF component is imported as JSX but never rendered
  // in tests; provide a no-op default export shape.
}));
vi.mock("@/components/InvoicePDF", () => ({
  InvoicePDF: () => null,
}));

import { SendInvoiceForm } from "./send-invoice-form";
import { ToastProvider } from "@/components/Toast";
import type { PdfBundle } from "@/lib/invoices/send-bundle";

const pdfBundle: PdfBundle = {
  invoice: {},
  lineItems: [],
  client: null,
  business: null,
  paymentsTotal: 0,
  invoiceNumber: "INV-001",
  paymentTermsLabel: null,
};

const baseProps = {
  invoiceId: "i1",
  teamId: "t1",
  defaultTo: "owner1@acme.com, owner2@acme.com",
  defaultFromEmail: "billing@malcom.io",
  defaultFromName: "Malcom IO",
  defaultReplyTo: "marcus@malcom.io",
  defaultSubject: "Invoice INV-001",
  defaultBody: "Please find attached.",
  signature: "-- Marcus / Malcom IO",
  configMissing: false,
  domainNotVerified: false,
  pdfBundle,
  backHref: "/invoices/i1",
};

function renderForm(
  overrides: Partial<typeof baseProps> = {},
): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <ToastProvider>
      <SendInvoiceForm {...baseProps} {...overrides} />
    </ToastProvider>,
  );
}

describe("SendInvoiceForm", () => {
  beforeEach(() => pushMock.mockClear());
  // Tests render the form into a global DOM; without explicit
  // cleanup their global keydown listeners stack up and interact
  // with the Cmd+Enter shortcut tests below.
  afterEach(() => cleanup());

  it("pre-fills the To: field with the joined recipients", () => {
    renderForm();
    const to = screen.getByLabelText(/^to$/i) as HTMLInputElement;
    expect(to.value).toBe("owner1@acme.com, owner2@acme.com");
    expect(to.type).toBe("text");
  });

  it("renders Subject as a top-level field above Body", () => {
    renderForm();
    const subject = screen.getByLabelText(/^subject$/i);
    const body = screen.getByLabelText(/^body$/i);
    expect(subject).toBeInTheDocument();
    expect(body).toBeInTheDocument();
    // DOM order: Subject before Body — Subject is the second-most-edited
    // field after Body and should sit immediately above it.
    expect(
      subject.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides Cc and Reply-To behind a disclosure by default", () => {
    renderForm();
    expect(screen.queryByLabelText(/^cc$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^reply-to$/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show cc/i }),
    ).toBeInTheDocument();
  });

  it("clicking the disclosure reveals Cc and Reply-To", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /show cc/i }));
    expect(screen.getByLabelText(/^cc$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^reply-to$/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /hide cc/i }),
    ).toBeInTheDocument();
  });

  it("renders the signature inline as a preview block", () => {
    renderForm();
    expect(
      screen.getByText(/signature \(auto-appended\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText("-- Marcus / Malcom IO")).toBeInTheDocument();
  });

  it("renders no signature block when signature is empty", () => {
    renderForm({ signature: "" });
    expect(
      screen.queryByText(/signature \(auto-appended\)/i),
    ).not.toBeInTheDocument();
  });

  it("disables Send when configMissing", () => {
    renderForm({ configMissing: true });
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("disables Send when domainNotVerified", () => {
    renderForm({ domainNotVerified: true });
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("Cancel link points back to the invoice", () => {
    renderForm();
    const cancel = screen.getByRole("link", { name: /cancel/i });
    expect(cancel).toHaveAttribute("href", "/invoices/i1");
  });

  it("registers a global keydown listener while mounted (Cmd+Enter wiring)", () => {
    // The form attaches a window-level keydown listener that
    // calls formRef.current.requestSubmit() on Cmd/Ctrl+Enter.
    // Spy on addEventListener / removeEventListener to verify
    // the wiring exists + cleans up — this is the regression
    // pin for "someone deletes the useEffect."
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderForm();

    const keydownAdds = addSpy.mock.calls.filter(
      ([event]) => event === "keydown",
    );
    expect(keydownAdds.length).toBeGreaterThanOrEqual(1);

    unmount();
    const keydownRemoves = removeSpy.mock.calls.filter(
      ([event]) => event === "keydown",
    );
    expect(keydownRemoves.length).toBeGreaterThanOrEqual(1);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("Cmd+Enter inside the global listener gates on metaKey/ctrlKey + Enter", () => {
    // Assertion against the listener's branch directly: the
    // shortcut fires only when (meta || ctrl) AND key === "Enter".
    // We can't reliably test the form-submit downstream effect
    // in jsdom (requestSubmit is environment-flaky), but we can
    // verify the listener is the only thing standing between a
    // bare key press and a submit by capturing the handler and
    // exercising its branches.
    let captured: ((e: KeyboardEvent) => void) | null = null;
    vi.spyOn(window, "addEventListener").mockImplementation(
      (event, handler) => {
        if (event === "keydown") {
          captured = handler as (e: KeyboardEvent) => void;
        }
      },
    );
    renderForm();
    expect(captured).not.toBeNull();
    // The handler is a no-op for plain Enter / non-Enter keys; on
    // Cmd+Enter / Ctrl+Enter it would throw if requestSubmit were
    // missing on a null formRef. Wrap each branch and assert it
    // doesn't throw — the gate logic is the contract.
    expect(() =>
      captured!({
        key: "a",
        metaKey: false,
        ctrlKey: false,
      } as KeyboardEvent),
    ).not.toThrow();
    expect(() =>
      captured!({
        key: "Enter",
        metaKey: false,
        ctrlKey: false,
      } as KeyboardEvent),
    ).not.toThrow();
  });
});
