import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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

describe("ThemePickerPopover", () => {
  beforeEach(() => setThemeSpy.mockClear());

  it("renders a single palette trigger button at rest", () => {
    renderWithIntl(<ThemePickerPopover />);
    // The trigger button's accessible name includes the current theme.
    expect(
      screen.getByRole("button", { name: /theme.*dark/i }),
    ).toBeInTheDocument();
    // No menu items visible yet
    expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
  });

  it("opens a menu with all 5 themes on click; current one is checked", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ThemePickerPopover />);
    await user.click(screen.getByRole("button", { name: /theme.*dark/i }));
    const items = screen.getAllByRole("menuitemradio");
    expect(items).toHaveLength(5);
    const dark = screen.getByRole("menuitemradio", { name: /dark/i });
    expect(dark).toHaveAttribute("aria-checked", "true");
  });

  it("clicking a theme calls setTheme and closes the menu", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ThemePickerPopover />);
    await user.click(screen.getByRole("button", { name: /theme.*dark/i }));
    // Visible label is "Reading" — selector key stays "warm".
    await user.click(screen.getByRole("menuitemradio", { name: /reading/i }));
    expect(setThemeSpy).toHaveBeenCalledWith("warm");
    await waitFor(() => {
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
    });
  });

  it("Escape closes the menu", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ThemePickerPopover />);
    await user.click(screen.getByRole("button", { name: /theme.*dark/i }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(5);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
    });
  });
});
