import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithIntl } from "@/test/intl";
import { ToastProvider } from "@/components/Toast";

const resendMock = vi.fn();
vi.mock("./actions", () => ({
  resendSignLinksAction: (fd: FormData) => resendMock(fd),
}));

import { ResendLinkButton } from "./resend-link-button";

function render(ui: ReactElement): RenderResult {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

beforeEach(() => resendMock.mockReset());

describe("ResendLinkButton", () => {
  it("calls the action and reports success in a toast", async () => {
    resendMock.mockResolvedValue({ success: true });
    render(<ResendLinkButton proposalId="prop-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Resend link/ }));
    await waitFor(() => expect(resendMock).toHaveBeenCalledTimes(1));
    expect((resendMock.mock.calls[0]![0] as FormData).get("id")).toBe("prop-1");
    await waitFor(() =>
      expect(screen.getByText(/Fresh sign link/)).toBeInTheDocument(),
    );
  });

  it("surfaces failure in an error toast — never a silent no-op", async () => {
    resendMock.mockResolvedValue({
      success: false,
      error: { message: "No outstanding sign links to re-issue." },
    });
    render(<ResendLinkButton proposalId="prop-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Resend link/ }));
    await waitFor(() =>
      expect(screen.getByText(/No outstanding/)).toBeInTheDocument(),
    );
  });
});
