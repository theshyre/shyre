import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithIntl } from "@/test/intl";
import { ToastProvider } from "@/components/Toast";

const deactivateMock = vi.fn();
const reactivateMock = vi.fn();
vi.mock("../actions", () => ({
  deactivateCustomerAction: (fd: FormData) => deactivateMock(fd),
  reactivateCustomerAction: (fd: FormData) => reactivateMock(fd),
}));

import { CustomerLifecycleButton } from "./customer-lifecycle-button";

function render(ui: ReactElement): RenderResult {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

beforeEach(() => {
  deactivateMock.mockReset();
  reactivateMock.mockReset();
});

describe("CustomerLifecycleButton", () => {
  it("active customer: 'Mark inactive' verb calls deactivate + offers Undo", async () => {
    deactivateMock.mockResolvedValue({ success: true });
    render(<CustomerLifecycleButton customerId="c1" inactive={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Mark inactive/ }));
    await waitFor(() => expect(deactivateMock).toHaveBeenCalledTimes(1));
    // Undo affordance rides the toast (non-destructive tier — no confirm).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Undo/i })).toBeInTheDocument(),
    );
  });

  it("inactive customer: 'Reactivate' verb calls reactivate", async () => {
    reactivateMock.mockResolvedValue({ success: true });
    render(<CustomerLifecycleButton customerId="c1" inactive />);
    fireEvent.click(screen.getByRole("button", { name: /Reactivate/ }));
    await waitFor(() => expect(reactivateMock).toHaveBeenCalledTimes(1));
    expect(deactivateMock).not.toHaveBeenCalled();
  });
});
