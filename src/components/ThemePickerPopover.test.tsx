import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/intl";

const setThemeSpy = vi.fn();

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: setThemeSpy,
    applyExternalTheme: vi.fn(),
    themes: ["system", "light", "dark", "high-contrast", "warm"] as const,
  }),
}));

import { ThemePickerPopover } from "./ThemePickerPopover";

vi.mock("@/app/(dashboard)/profile/actions", () => ({
  setAppearancePreferenceAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./Toast", () => ({
  useToast: () => ({ push: vi.fn() }),
}));


describe("ThemePickerPopover", () => {
  beforeEach(() => setThemeSpy.mockClear());

  it("renders a single palette trigger button at rest", () => {
    renderWithIntl(<ThemePickerPopover />);
    // The trigger button's accessible name includes the current theme.
    expect(
      screen.getByRole("button", { name: /theme.*dark/i }),
    ).toBeInTheDocument();
    // No menu items visible yet
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("opens a menu with all 6 themes on click; current one is checked", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ThemePickerPopover />);
    await user.click(screen.getByRole("button", { name: /theme.*dark/i }));
    const items = within(screen.getByRole("group")).getAllByRole("button");
    expect(items).toHaveLength(6);
    const dark = within(screen.getByRole("group")).getByRole("button", { name: /dark/i });
    expect(dark).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a theme calls setTheme and closes the menu", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ThemePickerPopover />);
    await user.click(screen.getByRole("button", { name: /theme.*dark/i }));
    // Visible label is "Reading" — selector key stays "warm".
    await user.click(within(screen.getByRole("group")).getByRole("button", { name: /reading/i }));
    expect(setThemeSpy).toHaveBeenCalledWith("warm");
    await waitFor(() => {
      expect(screen.queryByRole("group")).not.toBeInTheDocument();
    });
  });

  it("Escape closes the menu", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ThemePickerPopover />);
    await user.click(screen.getByRole("button", { name: /theme.*dark/i }));
    expect(within(screen.getByRole("group")).getAllByRole("button")).toHaveLength(6);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("group")).not.toBeInTheDocument();
    });
  });

  it("Escape restores focus to the trigger so keyboard users don't lose their place", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ThemePickerPopover />);
    const trigger = screen.getByRole("button", { name: /theme.*dark/i });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it("the active theme's Check icon is aria-hidden — aria-pressed alone carries the selected state", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ThemePickerPopover />);
    await user.click(screen.getByRole("button", { name: /theme.*dark/i }));
    const dark = within(screen.getByRole("group")).getByRole("button", {
      name: "Dark",
    });
    // Accessible name is exactly the theme label — no "Saved" suffix
    // double-announcing what aria-pressed already communicates.
    expect(dark).toHaveAccessibleName("Dark");
  });
});
