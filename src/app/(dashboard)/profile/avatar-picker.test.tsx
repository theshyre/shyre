import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const { setAvatarMock } = vi.hoisted(() => ({
  setAvatarMock: vi.fn(async (_fd: FormData) => {}),
}));

vi.mock("./actions", () => ({
  setAvatarAction: setAvatarMock,
}));

// Stub the Supabase browser client so upload paths don't fire network calls
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://cdn/test.png" } }),
      }),
    },
  }),
}));

import { AvatarPicker } from "./avatar-picker";

describe("AvatarPicker", () => {
  beforeEach(() => setAvatarMock.mockClear());

  it("shows the user's initial in the big preview when no avatar", () => {
    renderWithIntl(
      <AvatarPicker
        userId="u1"
        displayName="Marcus"
        initialAvatarUrl={null}
      />,
    );
    expect(screen.getAllByText("M").length).toBeGreaterThan(0);
  });

  it("renders the color preset buttons", () => {
    renderWithIntl(
      <AvatarPicker
        userId="u1"
        displayName="Marcus"
        initialAvatarUrl={null}
      />,
    );
    // Each preset renders as a button with aria-label = color key
    expect(screen.getByRole("button", { name: "blue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "violet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "slate" })).toBeInTheDocument();
  });

  it("picking a preset submits setAvatarAction with preset:<key>", async () => {
    renderWithIntl(
      <AvatarPicker
        userId="u1"
        displayName="Marcus"
        initialAvatarUrl={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "violet" }));
    await waitFor(() => expect(setAvatarMock).toHaveBeenCalled());
    const fd = setAvatarMock.mock.calls[0]?.[0];
    expect(fd?.get("avatar_url")).toBe("preset:violet");
  });

  it("Remove button clears the avatar (submits with no url)", async () => {
    renderWithIntl(
      <AvatarPicker
        userId="u1"
        displayName="Marcus"
        initialAvatarUrl="preset:blue"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await waitFor(() => expect(setAvatarMock).toHaveBeenCalled());
    const fd = setAvatarMock.mock.calls[0]?.[0];
    expect(fd?.get("avatar_url")).toBe(null);
  });

  it("marks the active preset with aria-pressed", () => {
    renderWithIntl(
      <AvatarPicker
        userId="u1"
        displayName="Marcus"
        initialAvatarUrl="preset:pink"
      />,
    );
    const pink = screen.getByRole("button", { name: "pink" });
    expect(pink).toHaveAttribute("aria-pressed", "true");
    const blue = screen.getByRole("button", { name: "blue" });
    expect(blue).toHaveAttribute("aria-pressed", "false");
  });
});
