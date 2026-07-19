import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const resolveMock = vi.fn();
vi.mock("./actions", () => ({
  resolveErrorGroupAction: (fd: FormData) => resolveMock(fd),
}));

import { ResolveButton } from "./resolve-button";

beforeEach(() => resolveMock.mockReset());

describe("ResolveButton", () => {
  it("submits the whole group's ids and flips to a Resolved confirmation", async () => {
    resolveMock.mockResolvedValue({ success: true });
    renderWithIntl(<ResolveButton errorIds={["err-1", "err-2", "err-3"]} />);

    fireEvent.click(screen.getByRole("button", { name: /Mark 3 resolved/ }));

    await waitFor(() => expect(resolveMock).toHaveBeenCalledTimes(1));
    expect(
      (resolveMock.mock.calls[0]?.[0] as FormData).get("error_ids"),
    ).toBe("err-1,err-2,err-3");
    // The form is replaced by the success state — no second submit possible.
    await waitFor(() =>
      expect(screen.getByText("Resolved")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /Mark 3 resolved/ }),
    ).not.toBeInTheDocument();
  });

  it("uses the singular label for a group of one", () => {
    renderWithIntl(<ResolveButton errorIds={["err-1"]} />);
    expect(
      screen.getByRole("button", { name: "Mark resolved" }),
    ).toBeInTheDocument();
  });

  it("stays on the button when the action fails (no false Resolved state)", async () => {
    resolveMock.mockResolvedValue({
      success: false,
      error: { code: "AUTH_FORBIDDEN", userMessageKey: "errors.authForbidden" },
    });
    renderWithIntl(<ResolveButton errorIds={["err-1"]} />);

    fireEvent.click(screen.getByRole("button", { name: /Mark resolved/ }));

    await waitFor(() => expect(resolveMock).toHaveBeenCalledTimes(1));
    // Once the transition settles the button returns to its idle
    // label — it must NOT flip to the success state.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Mark resolved/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
  });
});
