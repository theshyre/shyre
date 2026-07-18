import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithIntl } from "@/test/intl";
import { ToastProvider } from "@/components/Toast";
import type { IntegrationTokenRow } from "./token-constants";

const revokeMock = vi.fn();
vi.mock("./actions", () => ({
  revokeIntegrationTokenAction: (fd: FormData) => revokeMock(fd),
}));

import { TokenList } from "./token-list";

const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

function token(overrides: Partial<IntegrationTokenRow>): IntegrationTokenRow {
  return {
    id: "tok-1",
    user_id: "u-me",
    team_id: "t-1",
    name: "Laptop agent",
    token_prefix: "shyre_pat_ab34cd",
    scopes: ["context:read", "timer:write"],
    default_billable: true,
    created_at: "2026-07-01T10:00:00+00:00",
    expires_at: FUTURE,
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

const profiles = [
  { user_id: "u-me", display_name: "Marcus", avatar_url: null },
  { user_id: "u-other", display_name: "Alex", avatar_url: null },
];

function render(ui: ReactElement): RenderResult {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

beforeEach(() => revokeMock.mockReset());

describe("TokenList", () => {
  it("renders an empty state", () => {
    render(
      <TokenList
        tokens={[]}
        profiles={[]}
        currentUserId="u-me"
        now={Date.now()}
      />,
    );
    expect(screen.getByText(/No tokens yet/)).toBeInTheDocument();
  });

  it("lists name, prefix, scopes, billable default, and a Never last-used state", () => {
    render(
      <TokenList
        tokens={[token({})]}
        profiles={profiles}
        currentUserId="u-me"
        now={Date.now()}
      />,
    );
    expect(screen.getByText("Laptop agent")).toBeInTheDocument();
    expect(screen.getByText(/shyre_pat_ab34cd/)).toBeInTheDocument();
    expect(screen.getByText("context:read")).toBeInTheDocument();
    expect(screen.getByText("timer:write")).toBeInTheDocument();
    expect(screen.getByText("Billable")).toBeInTheDocument();
    expect(screen.getByText("Never")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/Your tokens/)).toBeInTheDocument();
    // Own group carries the viewer's avatar + name too (entity identity).
    expect(screen.getByText("Marcus")).toBeInTheDocument();
  });

  it("groups other members' tokens under their name (admin view)", () => {
    render(
      <TokenList
        tokens={[
          token({}),
          token({ id: "tok-2", user_id: "u-other", name: "Alex's CI" }),
        ]}
        profiles={profiles}
        currentUserId="u-me"
        now={Date.now()}
      />,
    );
    expect(screen.getByText(/Your tokens/)).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Alex's CI")).toBeInTheDocument();
  });

  it("renders a group header even when the owner has no profile row", () => {
    render(
      <TokenList
        tokens={[token({ id: "tok-9", user_id: "u-ghost", name: "Ghost CI" })]}
        profiles={[]}
        currentUserId="u-me"
        now={Date.now()}
      />,
    );
    // Falls back to the unknown-user author instead of omitting the slot.
    expect(screen.getByText("Ghost CI")).toBeInTheDocument();
    expect(screen.getByText(/Unknown/i)).toBeInTheDocument();
  });

  it("shows a Revoked badge and no revoke button for revoked tokens", () => {
    render(
      <TokenList
        tokens={[token({ revoked_at: PAST })]}
        profiles={profiles}
        currentUserId="u-me"
        now={Date.now()}
      />,
    );
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Revoke/ }),
    ).not.toBeInTheDocument();
  });

  it("shows an Expired badge and no revoke button when expires_at is in the past", () => {
    render(
      <TokenList
        tokens={[token({ expires_at: PAST })]}
        profiles={profiles}
        currentUserId="u-me"
        now={Date.now()}
      />,
    );
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Revoke/ }),
    ).not.toBeInTheDocument();
  });

  it("revoke uses an inline confirm that spells out the consequence", async () => {
    revokeMock.mockResolvedValue({ success: true });
    render(
      <TokenList
        tokens={[token({})]}
        profiles={profiles}
        currentUserId="u-me"
        now={Date.now()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Revoke$/ }));
    expect(
      screen.getByText(/stop working immediately/),
    ).toBeInTheDocument();
    // Focus lands on the confirm button (the trigger it replaced
    // unmounted) and the consequence copy describes it.
    const confirmButton = screen.getByRole("button", {
      name: /Revoke token/,
    });
    expect(confirmButton).toHaveFocus();
    expect(confirmButton).toHaveAccessibleDescription(
      /stop working immediately/,
    );

    fireEvent.click(screen.getByRole("button", { name: /Revoke token/ }));
    await waitFor(() => expect(revokeMock).toHaveBeenCalledTimes(1));
    const fd = revokeMock.mock.calls[0]![0] as FormData;
    expect(fd.get("token_id")).toBe("tok-1");
    expect(fd.get("team_id")).toBe("t-1");
  });

  it("cancel and Escape both back out of the confirm without revoking", () => {
    render(
      <TokenList
        tokens={[token({})]}
        profiles={profiles}
        currentUserId="u-me"
        now={Date.now()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Revoke$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(
      screen.queryByText(/stop working immediately/),
    ).not.toBeInTheDocument();
    // Focus returns to the row's Revoke button after backing out.
    expect(
      screen.getByRole("button", { name: /^Revoke$/ }),
    ).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: /^Revoke$/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByText(/stop working immediately/),
    ).not.toBeInTheDocument();
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("surfaces a verbatim revoke failure message inline", async () => {
    revokeMock.mockResolvedValue({
      success: false,
      error: { message: "RLS says no" },
    });
    render(
      <TokenList
        tokens={[token({})]}
        profiles={profiles}
        currentUserId="u-me"
        now={Date.now()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Revoke$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Revoke token/ }));
    await waitFor(() =>
      expect(screen.getByText(/RLS says no/)).toBeInTheDocument(),
    );
  });

  it("translates structured error keys instead of rendering them raw", async () => {
    revokeMock.mockResolvedValue({
      success: false,
      error: { userMessageKey: "integrations.errors.revokeNotFound" },
    });
    render(
      <TokenList
        tokens={[token({})]}
        profiles={profiles}
        currentUserId="u-me"
        now={Date.now()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Revoke$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Revoke token/ }));
    await waitFor(() =>
      expect(
        screen.getByText("Token not found or already revoked."),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("integrations.errors.revokeNotFound"),
    ).not.toBeInTheDocument();
  });
});
