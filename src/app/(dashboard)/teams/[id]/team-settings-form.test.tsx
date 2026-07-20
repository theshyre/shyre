import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

/**
 * Audit batch D: team-settings-form.tsx gained the unsaved-changes
 * guard (CLAUDE.md "Unsaved changes guard" rule) — previously the
 * only settings-shaped form without it. Asserts the browser-native
 * beforeunload prompt arms on edit and disarms after a successful
 * save, via the same `window.addEventListener` spy technique as
 * `use-unsaved-changes.test.ts`.
 */

const updateMock = vi.fn();
vi.mock("./team-settings-actions", () => ({
  updateTeamSettingsAction: (fd: FormData) => updateMock(fd),
  setTeamLogoAction: vi.fn(),
}));

// LogoPicker renders inside the branding section and calls
// createClient() from the browser client at import time — must be
// mockable even though this suite never exercises the upload path.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({
          data: { publicUrl: "https://x/branding/t-1/1.png" },
        }),
      }),
    },
  }),
}));

import { TeamSettingsForm } from "./team-settings-form";

const teamSettings = {
  business_name: "Acme LLC",
  business_email: null,
  business_address: null,
  business_phone: null,
  default_rate: 100,
  invoice_prefix: "INV",
  invoice_next_num: 1,
  tax_rate: 0,
  default_payment_terms_days: null,
  show_country_on_invoice: false,
  wordmark_primary: null,
  wordmark_secondary: null,
  brand_color: null,
  logo_url: null,
  rate_visibility: "owner",
  rate_editability: "owner",
  time_entries_visibility: "own_only",
  admins_can_set_rate_permissions: false,
};

describe("TeamSettingsForm — unsaved-changes guard", () => {
  let addSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    updateMock.mockReset();
    addSpy = vi.spyOn(window, "addEventListener");
  });

  afterEach(() => {
    addSpy.mockRestore();
  });

  it("arms the beforeunload guard as soon as a field changes", () => {
    renderWithIntl(
      <TeamSettingsForm teamSettings={teamSettings} teamId="t-1" role="owner" />,
    );
    expect(addSpy).not.toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
    fireEvent.change(screen.getByLabelText(/Business Name/), {
      target: { value: "Acme Consulting LLC" },
    });
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("disarms the guard after a successful save", async () => {
    updateMock.mockResolvedValue({ success: true });
    const removeSpy = vi.spyOn(window, "removeEventListener");
    renderWithIntl(
      <TeamSettingsForm teamSettings={teamSettings} teamId="t-1" role="owner" />,
    );
    fireEvent.change(screen.getByLabelText(/Business Name/), {
      target: { value: "Acme Consulting LLC" },
    });
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(removeSpy).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function),
      ),
    );
    removeSpy.mockRestore();
  });

  it("does not arm the guard on initial render (no edits yet)", () => {
    renderWithIntl(
      <TeamSettingsForm teamSettings={teamSettings} teamId="t-1" role="owner" />,
    );
    expect(addSpy).not.toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });
});
