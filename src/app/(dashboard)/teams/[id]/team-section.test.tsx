import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithIntl } from "@/test/intl";
import { ToastProvider } from "@/components/Toast";
import { TeamSection } from "./team-section";

// The action forms in TeamSection import real server actions ("use
// server" modules) — none of the tests below submit those forms, but
// mocking keeps the import graph free of the Supabase server client
// (matches the pattern in send-proposal-button.test.tsx).
vi.mock("./team-actions", () => ({
  inviteMemberAction: vi.fn(),
  removeMemberAction: vi.fn(),
  revokeInviteAction: vi.fn(),
  transferOwnershipAction: vi.fn(),
  updateMemberRoleAction: vi.fn(),
  updateTeamNameAction: vi.fn(),
}));
vi.mock("../actions", () => ({
  leaveTeamAction: vi.fn(),
  deleteTeamAction: vi.fn(),
}));

function render(ui: ReactElement): RenderResult {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

const writeTextMock = vi.fn();

beforeEach(() => {
  writeTextMock.mockReset();
  writeTextMock.mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
});

const baseMembers = [
  {
    id: "m-owner",
    user_id: "u-owner",
    role: "owner",
    joined_at: "2026-01-01T00:00:00Z",
    user_profiles: { display_name: "Alex Park" },
  },
];

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  acceptUrl: string | null;
}

function pendingInvite(overrides: Partial<PendingInvite> = {}): PendingInvite {
  return {
    id: "invite-1",
    email: "new@acme.test",
    role: "member",
    created_at: "2026-07-01T00:00:00Z",
    expires_at: "2026-07-08T00:00:00Z",
    acceptUrl: "https://app.shyre.test/auth/accept-invite?token=tok_abc123",
    ...overrides,
  };
}

describe("TeamSection — pending invites", () => {
  it("renders a Copy invite link button per pending invite for admins", () => {
    render(
      <TeamSection
        teamName="Acme Co"
        teamId="team-1"
        isPersonalOrg={false}
        currentRole="owner"
        currentUserId="u-owner"
        members={baseMembers}
        invites={[pendingInvite()]}
        hasEmailConfigured
      />,
    );
    expect(
      screen.getByRole("button", { name: /copy invite link/i }),
    ).toBeInTheDocument();
  });

  it("copies the accept URL to the clipboard and shows a success toast", async () => {
    render(
      <TeamSection
        teamName="Acme Co"
        teamId="team-1"
        isPersonalOrg={false}
        currentRole="owner"
        currentUserId="u-owner"
        members={baseMembers}
        invites={[pendingInvite()]}
        hasEmailConfigured
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy invite link/i }));
    await screen.findByText(/invite link copied/i);
    expect(writeTextMock).toHaveBeenCalledWith(
      "https://app.shyre.test/auth/accept-invite?token=tok_abc123",
    );
  });

  it("shows an error toast when the clipboard write fails", async () => {
    writeTextMock.mockRejectedValue(new Error("denied"));
    render(
      <TeamSection
        teamName="Acme Co"
        teamId="team-1"
        isPersonalOrg={false}
        currentRole="owner"
        currentUserId="u-owner"
        members={baseMembers}
        invites={[pendingInvite()]}
        hasEmailConfigured
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy invite link/i }));
    await screen.findByText(/couldn.t copy the link/i);
  });

  it("disables the copy control when the accept URL could not be built (NEXT_PUBLIC_APP_URL unset)", () => {
    const { container } = render(
      <TeamSection
        teamName="Acme Co"
        teamId="team-1"
        isPersonalOrg={false}
        currentRole="owner"
        currentUserId="u-owner"
        members={baseMembers}
        invites={[pendingInvite({ acceptUrl: null })]}
        hasEmailConfigured
      />,
    );
    const control = container.querySelector('[aria-disabled="true"]');
    expect(control).not.toBeNull();
    expect(control).toHaveTextContent(/copy invite link/i);
    fireEvent.click(control as HTMLElement);
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("does not show invite controls (or the copy button) to a plain member", () => {
    render(
      <TeamSection
        teamName="Acme Co"
        teamId="team-1"
        isPersonalOrg={false}
        currentRole="member"
        currentUserId="u-member"
        members={baseMembers}
        invites={[pendingInvite()]}
        hasEmailConfigured
      />,
    );
    expect(
      screen.queryByRole("button", { name: /copy invite link/i }),
    ).not.toBeInTheDocument();
  });
});

describe("TeamSection — email-not-configured hint", () => {
  it("shows a hint pointing at email setup when the team has no email configured", () => {
    render(
      <TeamSection
        teamName="Acme Co"
        teamId="team-1"
        isPersonalOrg={false}
        currentRole="owner"
        currentUserId="u-owner"
        members={baseMembers}
        invites={[]}
        hasEmailConfigured={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /invite/i }));
    expect(
      screen.getByText(/email isn.t set up for this team yet/i),
    ).toBeInTheDocument();
    const setupLink = screen.getByRole("link", { name: /set up email/i });
    expect(setupLink).toHaveAttribute("href", "/teams/team-1/email");
  });

  it("hides the hint once the team has email configured", () => {
    render(
      <TeamSection
        teamName="Acme Co"
        teamId="team-1"
        isPersonalOrg={false}
        currentRole="owner"
        currentUserId="u-owner"
        members={baseMembers}
        invites={[]}
        hasEmailConfigured
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /invite/i }));
    expect(
      screen.queryByText(/email isn.t set up for this team yet/i),
    ).not.toBeInTheDocument();
  });
});
