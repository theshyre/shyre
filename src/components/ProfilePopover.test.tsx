import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { ProfilePopover } from "./ProfilePopover";

const baseProps = {
  displayName: "Marcus Malcom",
  email: "marcus@malcom.io",
  avatarUrl: null,
  userId: "user-1",
  isProfileActive: false,
  isDocsActive: false,
  onSignOut: vi.fn(),
};

describe("ProfilePopover", () => {
  it("renders the trigger as a single row with name + chevron", () => {
    renderWithIntl(<ProfilePopover {...baseProps} />);
    const trigger = screen.getByRole("button", { name: /profile/i });
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain("Marcus Malcom");
    // Email is collapsed into the trigger's tooltip — the row stays
    // a single line so the sidebar saves vertical chrome.
    expect(trigger.textContent).not.toContain("marcus@malcom.io");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  });

  // Open-state interaction tests are deliberately deferred — the
  // menu body renders <TextSizeSwitcher> which requires a
  // TextSizeProvider context not yet wired into renderWithIntl.
  // Manual browser verification covers the open / close / sign-out
  // paths until that test wrapper is extended.
});
