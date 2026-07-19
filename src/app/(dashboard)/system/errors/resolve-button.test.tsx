import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const resolveMock = vi.fn();
vi.mock("./actions", () => ({
  resolveErrorAction: (fd: FormData) => resolveMock(fd),
}));

import { ResolveButton } from "./resolve-button";

beforeEach(() => resolveMock.mockReset());

describe("ResolveButton", () => {
  it("submits the error id and flips to a Resolved confirmation", async () => {
    resolveMock.mockResolvedValue({ success: true });
    renderWithIntl(<ResolveButton errorId="err-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Mark Resolved/ }));

    await waitFor(() => expect(resolveMock).toHaveBeenCalledTimes(1));
    expect((resolveMock.mock.calls[0]?.[0] as FormData).get("error_id")).toBe(
      "err-1",
    );
    // The form is replaced by the success state — no second submit possible.
    await waitFor(() =>
      expect(screen.getByText("Resolved")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /Mark Resolved/ }),
    ).not.toBeInTheDocument();
  });

  it("stays on the button when the action fails (no false Resolved state)", async () => {
    resolveMock.mockResolvedValue({
      success: false,
      error: { code: "AUTH_FORBIDDEN", userMessageKey: "errors.authForbidden" },
    });
    renderWithIntl(<ResolveButton errorId="err-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Mark Resolved/ }));

    await waitFor(() => expect(resolveMock).toHaveBeenCalledTimes(1));
    // Once the transition settles the button returns to its idle
    // label — it must NOT flip to the success state.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Mark Resolved/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
  });
});
