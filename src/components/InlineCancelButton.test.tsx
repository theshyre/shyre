import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/intl";
import { InlineCancelButton } from "./InlineCancelButton";

describe("InlineCancelButton", () => {
  it("renders an icon-only button labeled 'Cancel' by default", () => {
    renderWithIntl(<InlineCancelButton onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("fires onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithIntl(<InlineCancelButton onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows the visible tooltip bubble on focus (labelMode='label')", async () => {
    renderWithIntl(<InlineCancelButton onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Cancel" });
    fireEvent.focus(button);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Cancel");
  });

  it("accepts a custom label for both the tooltip and accessible name", async () => {
    renderWithIntl(<InlineCancelButton onClick={() => {}} label="Close" />);
    const button = screen.getByRole("button", { name: "Close" });
    fireEvent.focus(button);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Close");
  });

  it("respects disabled and does not fire onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithIntl(<InlineCancelButton onClick={onClick} disabled />);
    const button = screen.getByRole("button", { name: "Cancel" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("carries exactly one aria-label source (no duplicate manual aria-label)", () => {
    renderWithIntl(<InlineCancelButton onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Cancel" });
    expect(button.getAttributeNames().filter((n) => n === "aria-label")).toHaveLength(1);
  });
});
