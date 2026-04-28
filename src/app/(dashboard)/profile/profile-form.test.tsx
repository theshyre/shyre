import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("./actions", () => ({
  updateProfileAction: vi.fn(),
  updateUserSettingsAction: vi.fn(),
  updatePreferencesAction: vi.fn(),
  setAvatarAction: vi.fn(),
}));

// MfaSetup pulls in Supabase client; stub it out for render
vi.mock("@/components/MfaSetup", () => ({
  MfaSetup: () => null,
}));

// Stub the ThemeProvider + TextSizeProvider contexts so the hooks work in
// tests without wrapping with real providers.
const setThemeSpy = vi.fn();
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "system",
    setTheme: setThemeSpy,
    applyExternalTheme: vi.fn(),
    themes: ["system", "light", "dark", "high-contrast", "warm"] as const,
  }),
}));
const setTextSizeSpy = vi.fn();
vi.mock("@/components/text-size-provider", () => ({
  useTextSize: () => ({
    textSize: "regular",
    setTextSize: setTextSizeSpy,
    applyExternalTextSize: vi.fn(),
    sizes: ["compact", "regular", "large"] as const,
  }),
}));

import { ProfileForm } from "./profile-form";

const defaultProps = {
  userId: "user-1",
  email: "marcus@malcom.io",
  displayName: "Marcus",
  avatarUrl: "",
  githubToken: null,
  jiraBaseUrl: null,
  jiraEmail: null,
  jiraApiToken: null,
  preferredTheme: null,
  timezone: null,
  locale: null,
  weekStart: null,
  timeFormat: null,
} as const;

describe("ProfileForm", () => {
  it("renders Profile, Preferences, Security, Integrations sections", () => {
    renderWithIntl(<ProfileForm {...defaultProps} />);
    expect(screen.getByRole("heading", { name: /profile/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /preferences/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /security/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /integrations/i }),
    ).toBeInTheDocument();
  });

  it("renders display name + readonly email", () => {
    renderWithIntl(<ProfileForm {...defaultProps} />);
    expect(screen.getByDisplayValue("Marcus")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("marcus@malcom.io"),
    ).toBeInTheDocument();
  });

  it("renders all five theme buttons", () => {
    renderWithIntl(<ProfileForm {...defaultProps} />);
    expect(screen.getByRole("button", { name: /system/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /high contrast/i }),
    ).toBeInTheDocument();
    // Visible label is "Reading" — selector key stays "warm".
    expect(screen.getByRole("button", { name: /reading/i })).toBeInTheDocument();
  });

  it("renders three text-size buttons", () => {
    renderWithIntl(<ProfileForm {...defaultProps} />);
    expect(
      screen.getByRole("button", { name: /compact/i, pressed: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /regular/i, pressed: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^large$/i, pressed: false }),
    ).toBeInTheDocument();
  });

  it("shows selected timezone in the select", () => {
    renderWithIntl(
      <ProfileForm {...defaultProps} timezone="America/Los_Angeles" />,
    );
    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(select.value).toBe("America/Los_Angeles");
  });

  it("does NOT render Advanced / admin link cards", () => {
    // Admin things (Security Groups, Categories, Templates, Import) belong
    // in the sidebar Admin section, not in the user's profile page.
    renderWithIntl(<ProfileForm {...defaultProps} />);
    expect(
      screen.queryByRole("link", { name: /security groups/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /time categories/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /time templates/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /import data/i }),
    ).not.toBeInTheDocument();
  });

  it("clicking a theme button calls updatePreferencesAction via the form", async () => {
    const { updatePreferencesAction } = await import("./actions");
    const mock = vi.mocked(updatePreferencesAction);
    renderWithIntl(<ProfileForm {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^dark$/i }));
    // The hook calls the action asynchronously via a transition; just verify
    // it fired eventually
    await vi.waitFor(() => expect(mock).toHaveBeenCalled());
  });
});
