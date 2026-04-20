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
      /^admin$/i,
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

  it("shows unresolved-count badge on the Admin link for system admins", () => {
    renderWithIntl(
      <Sidebar {...defaults} isSystemAdmin unresolvedErrorCount={3} />,
    );
    const admin = screen.getByRole("link", { name: /admin/i });
    expect(admin).toHaveTextContent("3");
  });

  it("does NOT show the badge for non-admins even if a count leaked through", () => {
    renderWithIntl(
      <Sidebar
        {...defaults}
        isSystemAdmin={false}
        unresolvedErrorCount={3}
      />,
    );
    const admin = screen.getByRole("link", { name: /admin/i });
    expect(admin).not.toHaveTextContent("3");
  });

  it("renders profile identity that links to /profile", () => {
    renderWithIntl(<Sidebar {...defaults} />);
    const profileLink = screen.getByRole("link", { name: /your profile/i });
    expect(profileLink).toHaveAttribute("href", "/profile");
    expect(profileLink).toHaveTextContent("Marcus");
    expect(profileLink).toHaveTextContent("marcus@malcom.io");
  });

  it("renders text-size switcher + theme popover trigger in the footer", () => {
    renderWithIntl(<Sidebar {...defaults} />);
    // Three A buttons = text size
    expect(
      screen.getByRole("radio", { name: /compact/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /regular/i, checked: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /^large$/i }),
    ).toBeInTheDocument();
    // Theme popover trigger
    expect(
      screen.getByRole("button", { name: /theme/i }),
    ).toBeInTheDocument();
  });

  it("renders documentation link and sign-out button", () => {
    renderWithIntl(<Sidebar {...defaults} />);
    expect(
      screen.getByRole("link", { name: /documentation/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });

  it("renders the version string from NEXT_PUBLIC_APP_VERSION", () => {
    renderWithIntl(<Sidebar {...defaults} />);
    expect(screen.getByText(/shyre v0\.1\.0/i)).toBeInTheDocument();
  });
});
