import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

// The storage client is only exercised on the upload path; the render + remove
// paths (covered here) don't touch it, but it must be mockable to import.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://x/branding/t-1/1.png" } }),
      }),
    },
  }),
}));

import { LogoPicker } from "./LogoPicker";

const action = vi.fn().mockResolvedValue({ success: true });
beforeEach(() => action.mockClear());

describe("LogoPicker", () => {
  it("shows a placeholder + upload affordance with no logo yet", () => {
    renderWithIntl(
      <LogoPicker
        folder="t-1"
        initialUrl={null}
        action={action}
        hiddenFields={{ team_id: "t-1" }}
        altText="Team logo"
      />,
    );
    expect(screen.getByRole("button", { name: /Upload logo/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("previews an existing logo and can remove it — clearing via the action", async () => {
    renderWithIntl(
      <LogoPicker
        folder="t-1"
        initialUrl="https://x/branding/t-1/9.png"
        action={action}
        hiddenFields={{ team_id: "t-1" }}
        altText="Team logo"
      />,
    );
    expect(screen.getByAltText("Team logo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const sent = action.mock.calls[0]![0] as FormData;
    // Remove = commit with the context but NO logo_url.
    expect(sent.get("team_id")).toBe("t-1");
    expect(sent.get("logo_url")).toBeNull();
    // Preview cleared → the upload button now offers "Upload", not "Replace".
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Upload logo/ })).toBeInTheDocument(),
    );
  });
});
