import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const closeOut = vi.fn();
const reopen = vi.fn();
const getSummary = vi.fn();
vi.mock("../actions", () => ({
  closeOutProjectAction: (fd: FormData) => closeOut(fd),
  reopenProjectAction: (fd: FormData) => reopen(fd),
  getProjectUnbilledSummaryAction: (id: string) => getSummary(id),
}));

const push = vi.fn();
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ push }),
}));

import { ProjectLifecycleActions } from "./project-lifecycle-actions";

beforeEach(() => {
  closeOut.mockReset();
  reopen.mockReset();
  getSummary.mockReset();
  push.mockReset();
});

describe("ProjectLifecycleActions", () => {
  it("renders nothing for a non-admin", () => {
    const { container } = renderWithIntl(
      <ProjectLifecycleActions projectId="p-1" status="active" isAdmin={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a Close out button for a live admin", () => {
    renderWithIntl(
      <ProjectLifecycleActions projectId="p-1" status="active" isAdmin />,
    );
    expect(
      screen.getByRole("button", { name: /close out/i }),
    ).toBeInTheDocument();
  });

  it("shows a Reopen button for a completed project", () => {
    renderWithIntl(
      <ProjectLifecycleActions projectId="p-1" status="completed" isAdmin />,
    );
    expect(screen.getByRole("button", { name: /reopen/i })).toBeInTheDocument();
  });

  it("renders nothing for an archived project", () => {
    const { container } = renderWithIntl(
      <ProjectLifecycleActions projectId="p-1" status="archived" isAdmin />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("arms a confirm and surfaces the unbilled prompt on close-out", async () => {
    getSummary.mockResolvedValue({
      timeMinutes: 120,
      timeCount: 2,
      expenseCount: 0,
    });
    renderWithIntl(
      <ProjectLifecycleActions projectId="p-1" status="active" isAdmin />,
    );

    fireEvent.click(screen.getByRole("button", { name: /close out/i }));

    // The unbilled prompt appears after the summary resolves.
    await waitFor(() =>
      expect(screen.getByText(/unbilled time/i)).toBeInTheDocument(),
    );
    expect(getSummary).toHaveBeenCalledWith("p-1");
  });

  it("calls reopen and pushes a toast when Reopen is clicked", async () => {
    reopen.mockResolvedValue(undefined);
    renderWithIntl(
      <ProjectLifecycleActions projectId="p-1" status="completed" isAdmin />,
    );

    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));

    await waitFor(() => expect(reopen).toHaveBeenCalled());
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "success" }),
      ),
    );
  });
});
