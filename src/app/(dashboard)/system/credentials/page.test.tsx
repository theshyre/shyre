import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CredentialItem } from "@/lib/credentials/scan";

/**
 * Previously untested. Audit batch D translated the whole page
 * (title, empty state, group headings, scope labels, and the
 * expiryPhrase helper's plural forms) — this suite pins the
 * behavior against the real en catalog the same way
 * system/errors/page.test.tsx does, plus a focused unit pass on
 * `expiryPhrase` for the plural edge cases (1 day vs N days).
 */

const mockRequireSystemAdmin = vi.fn();
vi.mock("@/lib/system-admin", () => ({
  requireSystemAdmin: () => mockRequireSystemAdmin(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
}));

const mockScan = vi.fn();
vi.mock("@/lib/credentials/scan", () => ({
  scanCredentials: () => mockScan(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const admin = (await import("@/lib/i18n/locales/en/admin.json"))
      .default as Record<string, unknown>;
    return (key: string, vars?: Record<string, unknown>): string => {
      const path = [...namespace.split(".").slice(1), ...key.split(".")];
      let cur: unknown = admin;
      for (const part of path) {
        cur = (cur as Record<string, unknown>)[part];
      }
      let str = String(cur);
      if (vars && "count" in vars) {
        // Minimal ICU plural resolver — good enough for the two
        // forms (one/other) this catalog actually uses.
        const count = Number(vars.count);
        const match = /\{count, plural, one \{([^}]*)\} other \{([^}]*)\}\}/.exec(
          str,
        );
        if (match) {
          const form = count === 1 ? match[1] : match[2];
          str = (form ?? "").replace(/#/g, String(count));
        }
      }
      return str.replace(/\{(\w+)\}/g, (_m, name: string) =>
        String(vars?.[name] ?? ""),
      );
    };
  },
}));

import SystemCredentialsPage, { expiryPhrase } from "./page";
import type { getTranslations } from "next-intl/server";
import adminEn from "@/lib/i18n/locales/en/admin.json";

function item(overrides: Partial<CredentialItem>): CredentialItem {
  return {
    kind: "vercel_api_token",
    label: "Vercel API token",
    scope: "instance",
    scopeId: null,
    expiresAt: "2026-08-01",
    daysUntilExpiry: 5,
    severity: "critical",
    editUrl: "/system/deploy",
    ...overrides,
  };
}

async function renderPage(): Promise<void> {
  const jsx = await SystemCredentialsPage();
  render(jsx);
}

beforeEach(() => {
  mockRequireSystemAdmin.mockReset();
  mockRequireSystemAdmin.mockResolvedValue({ userId: "u-admin" });
  mockScan.mockReset();
});

describe("SystemCredentialsPage", () => {
  it("gates on requireSystemAdmin", async () => {
    mockRequireSystemAdmin.mockRejectedValue(new Error("forbidden"));
    mockScan.mockResolvedValue([]);
    await expect(renderPage()).rejects.toThrow(/forbidden/);
  });

  it("renders the translated empty state with a link to /system/deploy", async () => {
    mockScan.mockResolvedValue([]);
    await renderPage();
    expect(
      screen.getByText(/No credentials configured yet\. Visit/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "/system/deploy" }),
    ).toHaveAttribute("href", "/system/deploy");
  });

  it("groups by severity with the translated section heading and count", async () => {
    mockScan.mockResolvedValue([
      item({ kind: "vercel_api_token", severity: "expired", daysUntilExpiry: -3 }),
      item({ kind: "resend_api_key", severity: "critical", daysUntilExpiry: 2 }),
    ]);
    await renderPage();
    expect(screen.getByText("Expired (1)")).toBeInTheDocument();
    expect(screen.getByText("Expiring within 7 days (1)")).toBeInTheDocument();
  });

  it("shows the translated no-rotate-date hint for credentials without an expiry", async () => {
    mockScan.mockResolvedValue([
      item({ expiresAt: null, daysUntilExpiry: null, severity: "ok" }),
    ]);
    await renderPage();
    expect(
      screen.getByText("No rotate-by date set — pick one to enable reminders"),
    ).toBeInTheDocument();
  });

  it("renders the scope label and Update link per row", async () => {
    mockScan.mockResolvedValue([item({ scope: "team", editUrl: "/teams/t-1" })]);
    await renderPage();
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Update →" })).toHaveAttribute(
      "href",
      "/teams/t-1",
    );
  });
});

describe("expiryPhrase", () => {
  type PageTranslator = Awaited<ReturnType<typeof getTranslations>>;

  function makeT(): PageTranslator {
    const credentialsPage = adminEn.credentialsPage as Record<string, unknown>;
    const fn = (key: string, vars?: Record<string, unknown>): string => {
      let cur: unknown = credentialsPage;
      for (const part of key.split(".")) {
        cur = (cur as Record<string, unknown>)[part];
      }
      let str = String(cur);
      if (vars && "count" in vars) {
        const count = Number(vars.count);
        const match = /\{count, plural, one \{([^}]*)\} other \{([^}]*)\}\}/.exec(
          str,
        );
        if (match) {
          const form = count === 1 ? match[1] : match[2];
          str = (form ?? "").replace(/#/g, String(count));
        }
      }
      return str;
    };
    return fn as unknown as PageTranslator;
  }

  it("no expiration set", () => {
    expect(expiryPhrase({ daysUntilExpiry: null }, makeT())).toBe(
      "no expiration set",
    );
  });

  it("expires today", () => {
    expect(expiryPhrase({ daysUntilExpiry: 0 }, makeT())).toBe("expires today");
  });

  it("singular 'day' for exactly 1 day until expiry", () => {
    expect(expiryPhrase({ daysUntilExpiry: 1 }, makeT())).toBe(
      "1 day until expiry",
    );
  });

  it("plural 'days' for N > 1 days until expiry", () => {
    expect(expiryPhrase({ daysUntilExpiry: 5 }, makeT())).toBe(
      "5 days until expiry",
    );
  });

  it("singular 'day ago' for exactly 1 day expired", () => {
    expect(expiryPhrase({ daysUntilExpiry: -1 }, makeT())).toBe(
      "expired 1 day ago",
    );
  });

  it("plural 'days ago' for N > 1 days expired", () => {
    expect(expiryPhrase({ daysUntilExpiry: -14 }, makeT())).toBe(
      "expired 14 days ago",
    );
  });
});
