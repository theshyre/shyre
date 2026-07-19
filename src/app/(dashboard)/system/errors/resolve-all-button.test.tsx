import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const resolveAllMock = vi.fn();
vi.mock("./actions", () => ({
  resolveAllErrorsAction: (fd: FormData) => resolveAllMock(fd),
}));

import { ResolveAllButton } from "./resolve-all-button";

beforeEach(() => resolveAllMock.mockReset());

describe("ResolveAllButton", () => {
  it("arms an inline [Confirm][Cancel] instead of resolving on first click", () => {
    renderWithIntl(<ResolveAllButton severity={null} count={5} />);

    fireEvent.click(screen.getByRole("button", { name: "Resolve all" }));

    expect(resolveAllMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Resolve 5 errors" });
    expect(confirm).toBeInTheDocument();
    expect(confirm).toHaveFocus();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("Cancel disarms without calling the action", () => {
    renderWithIntl(<ResolveAllButton severity="error" count={2} />);

    fireEvent.click(screen.getByRole("button", { name: "Resolve all" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(resolveAllMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Resolve all" }),
    ).toBeInTheDocument();
  });

  it("Escape disarms without calling the action", () => {
    renderWithIntl(<ResolveAllButton severity={null} count={2} />);

    fireEvent.click(screen.getByRole("button", { name: "Resolve all" }));
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Resolve 2 errors" }),
      { key: "Escape" },
    );

    expect(resolveAllMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Resolve all" }),
    ).toBeInTheDocument();
  });

  it("Confirm submits with the active severity scope and flips to the success state", async () => {
    resolveAllMock.mockResolvedValue({ success: true });
    renderWithIntl(<ResolveAllButton severity="warning" count={4} />);

    fireEvent.click(screen.getByRole("button", { name: "Resolve all" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve 4 errors" }));

    await waitFor(() => expect(resolveAllMock).toHaveBeenCalledTimes(1));
    expect(
      (resolveAllMock.mock.calls[0]?.[0] as FormData).get("severity"),
    ).toBe("warning");
    await waitFor(() =>
      expect(screen.getByText("All resolved")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Resolve all" }),
    ).not.toBeInTheDocument();
  });

  it("submits severity=all when unscoped", async () => {
    resolveAllMock.mockResolvedValue({ success: true });
    renderWithIntl(<ResolveAllButton severity={null} count={1} />);

    fireEvent.click(screen.getByRole("button", { name: "Resolve all" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve 1 error" }));

    await waitFor(() => expect(resolveAllMock).toHaveBeenCalledTimes(1));
    expect(
      (resolveAllMock.mock.calls[0]?.[0] as FormData).get("severity"),
    ).toBe("all");
  });

  it("stays armed (no success state) when the action fails", async () => {
    resolveAllMock.mockResolvedValue({
      success: false,
      error: { code: "AUTH_FORBIDDEN", userMessageKey: "errors.authForbidden" },
    });
    renderWithIntl(<ResolveAllButton severity={null} count={2} />);

    fireEvent.click(screen.getByRole("button", { name: "Resolve all" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve 2 errors" }));

    await waitFor(() => expect(resolveAllMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Resolve 2 errors" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("All resolved")).not.toBeInTheDocument();
  });
});
