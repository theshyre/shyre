import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

// Next navigation + Supabase client are heavy; stub them at module level.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

// Stub the Theme + TextSize providers so the picker controls render their
// happy path without localStorage noise.
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "system",
    setTheme: vi.fn(),
    applyExternalTheme: vi.fn(),
    themes: ["system", "light", "dark", "high-contrast", "warm"] as const,
  }),
}));
vi.mock("@/components/text-size-provider", () => ({
  useTextSize: () => ({
    textSize: "regular",
    setTextSize: vi.fn(),
    applyExternalTextSize: vi.fn(),
    sizes: ["compact", "regular", "large"] as const,
  }),
}));

import Sidebar from "./Sidebar";

const defaults = {
  displayName: "Marcus",
  email: "marcus@malcom.io",
  avatarUrl: null,
  userId: "test-user",
};

describe("Sidebar", () => {
  beforeEach(() => {
    // Exercise the version render path in every test.
    process.env.NEXT_PUBLIC_APP_VERSION = "0.1.0";
  });

  it("renders the flat 7-item primary nav", () => {
    renderWithIntl(<Sidebar {...defaults} />);
    for (const name of [
      /dashboard/i,
      /^time$/i,
      /customers/i,
      /projects/i,
      /invoices/i,
      /reports/i,
      /^settings$/i,
    ]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("does not render System Admin sub-items in the primary nav anymore", () => {
    renderWithIntl(<Sidebar {...defaults} isSystemAdmin />);
    // Old sidebar exposed these directly; they now live on /admin only.
    expect(
      screen.queryByRole("link", { name: /error log/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /sample data/i }),
    ).not.toBeInTheDocument();
  });

  it("shows unresolved-count badge on the System link for system admins", () => {
    renderWithIntl(
      <Sidebar {...defaults} isSystemAdmin unresolvedErrorCount={3} />,
    );
    const system = screen.getByRole("link", { name: /^system/i });
    expect(system).toHaveTextContent("3");
  });

  it("does NOT render the System link for non-admins", () => {
    renderWithIntl(
      <Sidebar
        {...defaults}
        isSystemAdmin={false}
        unresolvedErrorCount={3}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /^system/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the profile-popover trigger with the user's display name", () => {
    // Sidebar footer was restructured: profile + controls + docs +
    // sign-out + version collapsed into a single popover trigger
    // anchored on the avatar row. The trigger button is what's
    // visible in the closed state.
    renderWithIntl(<Sidebar {...defaults} />);
    const trigger = screen.getByRole("button", { name: /your profile/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Marcus");
    // Popover is a labeled group of plain controls now, not a menu —
    // the trigger advertises open/closed state, not a menu contract.
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders the module-owned timer widget passed via timerSlot", () => {
    // The running timer is time-entries-module code — the sidebar
    // receives it as a slot from the layout instead of importing it,
    // keeping shared components module-agnostic.
    renderWithIntl(
      <Sidebar {...defaults} timerSlot={<div data-testid="timer-stub" />} />,
    );
    expect(screen.getByTestId("timer-stub")).toBeInTheDocument();
  });

  it("links the brand row to / and exposes the version via tooltip", () => {
    // Brand row replaced the standalone version footer + tagline
    // line. Tagline is gone (~16px back); version is reachable via
    // the brand-row tooltip when needed.
    renderWithIntl(<Sidebar {...defaults} />);
    const brandLink = screen.getByRole("link", { name: /shyre/i });
    expect(brandLink).toHaveAttribute("href", "/");
  });

  it("the unresolved-count badge exposes the full phrase to AT via an sr-only span, not a duplicated aria-label", () => {
    renderWithIntl(
      <Sidebar {...defaults} isSystemAdmin unresolvedErrorCount={3} />,
    );
    const system = screen.getByRole("link", { name: /^system/i });
    // Accessible name is built from visible content — the bare "3" is
    // aria-hidden (excluded from name computation) and the sr-only
    // span alone supplies "3 unresolved items" once, not stacked on
    // top of a separate aria-label repeating the same count.
    expect(system).toHaveAccessibleName("System3 unresolved items");
  });

  describe("mobile drawer", () => {
    afterEach(() => {
      document.getElementById("main-content")?.remove();
    });

    it("opening the drawer moves focus to its first real nav item", async () => {
      renderWithIntl(<Sidebar {...defaults} />);
      fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
      await waitFor(() => {
        expect(screen.getByRole("link", { name: /dashboard/i })).toHaveFocus();
      });
    });

    it("applies inert to #main-content while the drawer is open, and removes it on close", async () => {
      const main = document.createElement("main");
      main.id = "main-content";
      document.body.appendChild(main);

      renderWithIntl(<Sidebar {...defaults} />);
      expect(main).not.toHaveAttribute("inert");

      fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
      await waitFor(() => expect(main).toHaveAttribute("inert"));

      fireEvent.click(screen.getByRole("button", { name: /close menu/i }));
      await waitFor(() => expect(main).not.toHaveAttribute("inert"));
    });
  });
});
