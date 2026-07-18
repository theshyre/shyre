import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const toggleMock = vi.fn();
vi.mock("./actions", () => ({
  setIntegrationsEnabledAction: (fd: FormData) => toggleMock(fd),
}));

import { KillSwitchCard } from "./kill-switch-card";

beforeEach(() => toggleMock.mockReset());

describe("KillSwitchCard", () => {
  it("shows the default-closed explanation and Disabled badge when off", () => {
    renderWithIntl(
      <KillSwitchCard teamId="t-1" enabled={false} isAdmin={true} />,
    );
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(
      screen.getByText(/off by default/i),
    ).toBeInTheDocument();
  });

  it("shows the Enabled badge and what-enabled-means copy when on", () => {
    renderWithIntl(
      <KillSwitchCard teamId="t-1" enabled={true} isAdmin={true} />,
    );
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(
      screen.getByText(/valid token can read/i),
    ).toBeInTheDocument();
  });

  it("admin sees an Enable toggle that submits team_id + enabled=true", async () => {
    toggleMock.mockResolvedValue({ success: true });
    renderWithIntl(
      <KillSwitchCard teamId="t-1" enabled={false} isAdmin={true} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Enable integrations/ }),
    );
    await waitFor(() => expect(toggleMock).toHaveBeenCalledTimes(1));
    const fd = toggleMock.mock.calls[0]![0] as FormData;
    expect(fd.get("team_id")).toBe("t-1");
    expect(fd.get("enabled")).toBe("true");
  });

  it("admin disabling warns that existing tokens stop immediately", () => {
    renderWithIntl(
      <KillSwitchCard teamId="t-1" enabled={true} isAdmin={true} />,
    );
    expect(
      screen.getByRole("button", { name: /Disable integrations/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/immediately blocks every existing token/i),
    ).toBeInTheDocument();
  });

  it("member sees the ask-your-owner hint instead of a toggle", () => {
    renderWithIntl(
      <KillSwitchCard teamId="t-1" enabled={false} isAdmin={false} />,
    );
    expect(
      screen.getByText(/Ask your team owner/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("surfaces a server error inline", async () => {
    toggleMock.mockResolvedValue({
      success: false,
      error: { message: "Only owners and admins can change integrations." },
    });
    renderWithIntl(
      <KillSwitchCard teamId="t-1" enabled={false} isAdmin={true} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Enable integrations/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Only owners and admins/),
      ).toBeInTheDocument(),
    );
  });
});
