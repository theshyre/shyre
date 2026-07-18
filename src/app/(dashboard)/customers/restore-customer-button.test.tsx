import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithIntl } from "@/test/intl";
import { ToastProvider } from "@/components/Toast";

const restoreMock = vi.fn();
vi.mock("./actions", () => ({
  bulkRestoreCustomersAction: (fd: FormData) => restoreMock(fd),
}));

import { RestoreCustomerButton } from "./restore-customer-button";

function render(ui: ReactElement): RenderResult {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

beforeEach(() => restoreMock.mockReset());

describe("RestoreCustomerButton", () => {
  it("restores the customer and confirms in a toast", async () => {
    restoreMock.mockResolvedValue({ success: true });
    render(<RestoreCustomerButton customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: /Restore/ }));
    await waitFor(() => expect(restoreMock).toHaveBeenCalledTimes(1));
    expect((restoreMock.mock.calls[0]![0] as FormData).getAll("id")).toEqual([
      "c1",
    ]);
    await waitFor(() =>
      expect(screen.getByText(/Customer restored/)).toBeInTheDocument(),
    );
  });

  it("surfaces failure in an error toast", async () => {
    restoreMock.mockResolvedValue({
      success: false,
      error: { message: "RLS says no" },
    });
    render(<RestoreCustomerButton customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: /Restore/ }));
    await waitFor(() =>
      expect(screen.getByText(/RLS says no/)).toBeInTheDocument(),
    );
  });
});
