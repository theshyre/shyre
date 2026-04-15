import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/intl";

const { restoreMock, permanentlyDeleteMock } = vi.hoisted(() => ({
  restoreMock: vi.fn(async (_fd: FormData) => {}),
  permanentlyDeleteMock: vi.fn(async (_fd: FormData) => {}),
}));

vi.mock("../actions", () => ({
  restoreTimeEntryAction: restoreMock,
  permanentlyDeleteTimeEntryAction: permanentlyDeleteMock,
}));

import { TrashList } from "./trash-list";
import { ToastProvider } from "@/components/Toast";

function makeEntry(id: string) {
  return {
    id,
    start_time: "2026-04-10T00:00:00Z",
    end_time: "2026-04-10T01:30:00Z",
    duration_min: 90,
    description: null,
    billable: true,
    deleted_at: "2026-04-14T12:00:00Z",
    project_name: "Alpha",
    customer_name: "Acme",
    category: { name: "Build", color: "#00aa00" },
  };
}

describe("TrashList", () => {
  it("renders a row per entry with project, customer, duration", () => {
    renderWithIntl(
      <ToastProvider>
        <TrashList entries={[makeEntry("e1")]} formatDuration={(m) => `${m}m`} />
      </ToastProvider>,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText(/acme/i)).toBeInTheDocument();
    expect(screen.getByText(/build/i)).toBeInTheDocument();
  });

  it("Restore calls restoreTimeEntryAction with id + toasts on success", async () => {
    renderWithIntl(
      <ToastProvider>
        <TrashList entries={[makeEntry("e1")]} formatDuration={(m) => `${m}m`} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /restore/i }));
    await waitFor(() => expect(restoreMock).toHaveBeenCalled());
    const fd = restoreMock.mock.calls[0]?.[0];
    expect(fd?.get("id")).toBe("e1");
    expect(await screen.findByText(/entry restored/i)).toBeInTheDocument();
  });

  it("Permanently delete is a two-click inline confirm", async () => {
    renderWithIntl(
      <ToastProvider>
        <TrashList entries={[makeEntry("e1")]} formatDuration={(m) => `${m}m`} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /permanently delete/i }));
    await user.click(screen.getByRole("button", { name: /confirm delete/i }));
    await waitFor(() => expect(permanentlyDeleteMock).toHaveBeenCalled());
    const fd = permanentlyDeleteMock.mock.calls[0]?.[0];
    expect(fd?.get("id")).toBe("e1");
  });
});
