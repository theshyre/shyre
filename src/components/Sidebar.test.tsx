import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

// Next navigation + Supabase client are heavy; stub them at module level.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

// Silence the Timer widget — it mounts its own Supabase subscription which
// isn't relevant to sidebar rendering.
vi.mock("@/components/Timer", () => ({
  default: () => <div data-testid="timer-stub" />,
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
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("links the brand row to / and exposes the version via tooltip", () => {
    // Brand row replaced the standalone version footer + tagline
    // line. Tagline is gone (~16px back); version is reachable via
    // the brand-row tooltip when needed.
    renderWithIntl(<Sidebar {...defaults} />);
    const brandLink = screen.getByRole("link", { name: /shyre/i });
    expect(brandLink).toHaveAttribute("href", "/");
  });
});
