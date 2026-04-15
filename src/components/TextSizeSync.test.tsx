import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextSizeProvider } from "./text-size-provider";
import { TextSizeSync } from "./TextSizeSync";
import { TextSizeSwitcher } from "./TextSizeSwitcher";
import { NextIntlClientProvider } from "next-intl";
import settings from "@/lib/i18n/locales/en/settings.json";

function renderHarness(preferredTextSize: "compact" | "regular" | "large" | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ settings }}>
      <TextSizeProvider>
        <TextSizeSync preferredTextSize={preferredTextSize} />
        <TextSizeSwitcher />
      </TextSizeProvider>
    </NextIntlClientProvider>,
  );
}

describe("TextSizeSync + provider integration", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-text-size");
  });

  it("applies the DB preference on mount when it differs from local state", () => {
    renderHarness("large");
    expect(document.documentElement.getAttribute("data-text-size")).toBe(
      "large",
    );
  });

  it("does NOT snap back when the user picks a different size in-app", async () => {
    const user = userEvent.setup();
    // DB has 'large'; provider defaults to 'regular'. Sync pushes 'large'.
    renderHarness("large");
    expect(document.documentElement.getAttribute("data-text-size")).toBe(
      "large",
    );
    // User clicks Compact in the switcher. This is the exact path that
    // used to be clobbered by the sync's over-eager effect.
    await user.click(screen.getByRole("radio", { name: /compact/i }));
    // Attribute MUST stay on 'compact' — this is the regression guard.
    expect(document.documentElement.getAttribute("data-text-size")).toBe(
      "compact",
    );
  });

  it("leaves attribute unset when DB preference is null and no click happened", () => {
    renderHarness(null);
    expect(
      document.documentElement.getAttribute("data-text-size"),
    ).toBeNull();
  });
});
