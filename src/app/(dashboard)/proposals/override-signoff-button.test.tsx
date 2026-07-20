import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const overrideMock = vi.fn();
vi.mock("./actions", () => ({
  overrideProposalSignoffAction: (fd: FormData) => overrideMock(fd),
}));

import { OverrideSignoffButton } from "./override-signoff-button";

beforeEach(() => overrideMock.mockReset());

describe("OverrideSignoffButton", () => {
  it("requires a reason before the confirm arms", () => {
    renderWithIntl(
      <OverrideSignoffButton proposalId="p1" waivedNames={["Mijeong Andre"]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Override sign-off/ }));
    const confirm = screen.getByRole("button", { name: /Complete sign-off/ });
    expect(confirm).toBeDisabled();
    expect(overrideMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Reason for the override/), {
      target: { value: "hi" },
    });
    expect(confirm).toBeDisabled();
  });

  it("names the signers being waived", () => {
    renderWithIntl(
      <OverrideSignoffButton proposalId="p1" waivedNames={["Mijeong Andre"]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Override sign-off/ }));
    expect(screen.getByText(/Mijeong Andre/)).toBeInTheDocument();
  });

  it("submits the id + note once a real reason is typed", async () => {
    overrideMock.mockResolvedValue({ success: true });
    renderWithIntl(
      <OverrideSignoffButton proposalId="p1" waivedNames={["Mijeong Andre"]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Override sign-off/ }));
    fireEvent.change(screen.getByLabelText(/Reason for the override/), {
      target: { value: "Co-signer left the company." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Complete sign-off/ }));
    await waitFor(() => expect(overrideMock).toHaveBeenCalledTimes(1));
    const fd = overrideMock.mock.calls[0]![0] as FormData;
    expect(fd.get("id")).toBe("p1");
    expect(fd.get("note")).toBe("Co-signer left the company.");
  });

  it("surfaces action failure inline — never a silent no-op", async () => {
    overrideMock.mockResolvedValue({
      success: false,
      error: { message: "Only an in-flight proposal awaiting signatures can be overridden." },
    });
    renderWithIntl(
      <OverrideSignoffButton proposalId="p1" waivedNames={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Override sign-off/ }));
    fireEvent.change(screen.getByLabelText(/Reason for the override/), {
      target: { value: "changed our mind" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Complete sign-off/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/in-flight/),
    );
  });
});
