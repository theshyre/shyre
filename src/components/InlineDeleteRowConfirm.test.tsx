import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/intl";
import { InlineDeleteRowConfirm } from "./InlineDeleteRowConfirm";

describe("InlineDeleteRowConfirm", () => {
  it("renders only the Trash trigger at rest", () => {
    renderWithIntl(
      <InlineDeleteRowConfirm
        ariaLabel="Delete row"
        onConfirm={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /delete row/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/type delete to confirm/i),
    ).not.toBeInTheDocument();
  });

  it("clicking trash reveals the prompt + input, disabled Delete until typed", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <InlineDeleteRowConfirm
        ariaLabel="Delete row"
        onConfirm={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /delete row/i }));
    const input = await screen.findByLabelText(/type delete to confirm/i);
    expect(input).toBeInTheDocument();
    const confirmBtn = screen.getByRole("button", { name: /confirm delete/i });
    expect(confirmBtn).toBeDisabled();
  });

  it("typing the exact word arms the red Delete button", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithIntl(
      <InlineDeleteRowConfirm
        ariaLabel="Delete row"
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: /delete row/i }));
    const input = await screen.findByLabelText(/type delete to confirm/i);
    await user.type(input, "delete");
    const confirmBtn = screen.getByRole("button", { name: /confirm delete/i });
    expect(confirmBtn).not.toBeDisabled();
    await user.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("is case-insensitive to the typed word", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithIntl(
      <InlineDeleteRowConfirm
        ariaLabel="Delete row"
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: /delete row/i }));
    const input = await screen.findByLabelText(/type delete to confirm/i);
    await user.type(input, "DELETE");
    await user.click(screen.getByRole("button", { name: /confirm delete/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("Escape cancels without firing onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithIntl(
      <InlineDeleteRowConfirm
        ariaLabel="Delete row"
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: /delete row/i }));
    await screen.findByLabelText(/type delete to confirm/i);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByLabelText(/type delete to confirm/i),
      ).not.toBeInTheDocument();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Enter key fires onConfirm when the word matches", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithIntl(
      <InlineDeleteRowConfirm
        ariaLabel="Delete row"
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: /delete row/i }));
    const input = await screen.findByLabelText(/type delete to confirm/i);
    await user.type(input, "delete{Enter}");
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
