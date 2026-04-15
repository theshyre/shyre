import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/intl";
import { InlineDeleteButton } from "./InlineDeleteButton";

describe("InlineDeleteButton", () => {
  it("renders only the Trash trigger at rest", () => {
    renderWithIntl(
      <InlineDeleteButton ariaLabel="Delete row" onConfirm={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /delete row/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it("reveals Confirm + Cancel on first click, hides original Trash", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <InlineDeleteButton ariaLabel="Delete row" onConfirm={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: /delete row/i }));
    expect(screen.queryByRole("button", { name: /delete row/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm delete/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("calls onConfirm when Confirm is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithIntl(
      <InlineDeleteButton ariaLabel="Delete row" onConfirm={onConfirm} />,
    );
    await user.click(screen.getByRole("button", { name: /delete row/i }));
    await user.click(screen.getByRole("button", { name: /confirm delete/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("returns to idle after Cancel without calling onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithIntl(
      <InlineDeleteButton ariaLabel="Delete row" onConfirm={onConfirm} />,
    );
    await user.click(screen.getByRole("button", { name: /delete row/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /delete row/i })).toBeInTheDocument();
  });

  it("auto-reverts to idle after resetMs", async () => {
    const user = userEvent.setup();
    // Use a short resetMs with real timers instead of fake timers — fake timers
    // don't play well with waitFor under this setup.
    renderWithIntl(
      <InlineDeleteButton
        ariaLabel="Delete row"
        onConfirm={() => {}}
        resetMs={80}
      />,
    );
    await user.click(screen.getByRole("button", { name: /delete row/i }));
    expect(screen.getByRole("button", { name: /confirm delete/i })).toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /delete row/i })).toBeInTheDocument();
      },
      { timeout: 500 },
    );
  });

  it("Escape cancels confirm state", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <InlineDeleteButton ariaLabel="Delete row" onConfirm={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: /delete row/i }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: /delete row/i })).toBeInTheDocument();
  });

  it("renders confirmDescription when provided", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <InlineDeleteButton
        ariaLabel="Delete row"
        confirmDescription="3 entries"
        onConfirm={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /delete row/i }));
    expect(screen.getByText("3 entries")).toBeInTheDocument();
  });

  it("disabled idle trigger does not open confirm state", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <InlineDeleteButton ariaLabel="Delete row" onConfirm={() => {}} disabled />,
    );
    await user.click(screen.getByRole("button", { name: /delete row/i }));
    expect(screen.queryByRole("button", { name: /confirm delete/i })).not.toBeInTheDocument();
  });
});
