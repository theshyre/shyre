import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { ToastProvider } from "@/components/Toast";

/**
 * Batch D translated every hardcoded English string in this component
 * (team name, invite form, member role badges/select, pending invites,
 * leave/transfer/delete danger-zone flows) — each section is smoke-tested
 * against the real en catalog (renderWithIntl throws / renders a raw key
 * on a typo'd path). Batch C added the invite email-delivery surface —
 * the per-invite Copy-invite-link button and the email-not-configured
 * hint — covered by the last two describe blocks.
 */

const removeMemberMock = vi.fn();
const updateMemberRoleMock = vi.fn();
const revokeInviteMock = vi.fn();
const transferOwnershipMock = vi.fn();
const updateTeamNameMock = vi.fn();
const inviteMemberMock = vi.fn();
vi.mock("./team-actions", () => ({
  inviteMemberAction: (fd: FormData) => inviteMemberMock(fd),
  removeMemberAction: (fd: FormData) => removeMemberMock(fd),
  revokeInviteAction: (fd: FormData) => revokeInviteMock(fd),
  transferOwnershipAction: (fd: FormData) => transferOwnershipMock(fd),
  updateMemberRoleAction: (fd: FormData) => updateMemberRoleMock(fd),
  updateTeamNameAction: (fd: FormData) => updateTeamNameMock(fd),
}));

const leaveTeamMock = vi.fn();
const deleteTeamMock = vi.fn();
vi.mock("../actions", () => ({
  leaveTeamAction: (fd: FormData) => leaveTeamMock(fd),
  deleteTeamAction: (fd: FormData) => deleteTeamMock(fd),
}));

import { TeamSection } from "./team-section";

function render(ui: React.ReactElement) {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

const owner = {
  id: "m-owner",
  user_id: "u-owner",
  role: "owner",
  joined_at: "2026-01-01T00:00:00+00:00",
  user_profiles: { display_name: "Ada Owner" },
};
const admin = {
  id: "m-admin",
  user_id: "u-admin",
  role: "admin",
  joined_at: "2026-01-01T00:00:00+00:00",
  user_profiles: { display_name: "Bea Admin" },
};
const member = {
  id: "m-member",
  user_id: "u-member",
  role: "member",
  joined_at: "2026-01-01T00:00:00+00:00",
  user_profiles: { display_name: "Cy Member" },
  is_shell: true,
};

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

const writeTextMock = vi.fn();

beforeEach(() => {
  removeMemberMock.mockReset();
  updateMemberRoleMock.mockReset();
  revokeInviteMock.mockReset();
  transferOwnershipMock.mockReset();
  updateTeamNameMock.mockReset();
  inviteMemberMock.mockReset();
  leaveTeamMock.mockReset();
  deleteTeamMock.mockReset();
  writeTextMock.mockReset();
  writeTextMock.mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
});

describe("TeamSection — owner view", () => {
  it("renders the rename form, member list with translated role badges, and the shell badge", () => {
    render(
      <TeamSection
        teamName="Acme"
        teamId="t-1"
        isPersonalOrg={false}
        currentRole="owner"
        currentUserId="u-owner"
        members={[owner, admin, member]}
        invites={[]}
        hasEmailConfigured
      />,
    );
    expect(screen.getByLabelText("Team Name")).toHaveValue("Acme");
    expect(screen.getByText("Team owner")).toBeInTheDocument();
    // "Admin" appears both as the row badge and as an option in that
    // row's own role-change <select> — at least one is required.
    expect(screen.getAllByText("Admin").length).toBeGreaterThan(0);
    expect(screen.getByText("Imported · no login")).toBeInTheDocument();
    expect(screen.getByText("(you)")).toBeInTheDocument();
  });

  it("opens the invite form with translated labels and role options", () => {
    render(
      <TeamSection
        teamName="Acme"
        teamId="t-1"
        isPersonalOrg={false}
        currentRole="owner"
        currentUserId="u-owner"
        members={[owner]}
        invites={[]}
        hasEmailConfigured
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Invite/ }));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("colleague@example.com"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Member" }),
    ).toBeInTheDocument();
  });

  it("renders pending invites with translated role + expiry copy and a Revoke button", () => {
    render(
      <TeamSection
        teamName="Acme"
        teamId="t-1"
        isPersonalOrg={false}
        currentRole="owner"
        currentUserId="u-owner"
        members={[owner]}
        invites={[
          pendingInvite({
            id: "inv-1",
            role: "admin",
            created_at: "2026-01-01T00:00:00+00:00",
            expires_at: "2026-08-01T00:00:00+00:00",
          }),
        ]}
        hasEmailConfigured
      />,
    );
    expect(screen.getByText("Pending Invites")).toBeInTheDocument();
    expect(screen.getByText(/Admin · expires/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revoke/ })).toBeInTheDocument();
  });

  it("shows the no-owner warning when the team has no owner row", () => {
    render(
      <TeamSection
        teamName="Acme"
        teamId="t-1"
        isPersonalOrg={false}
        currentRole="admin"
        currentUserId="u-admin"
        members={[admin]}
        invites={[]}
        hasEmailConfigured
      />,
    );
    expect(
      screen.getByText(/This team has no owner\. Contact support/),
    ).toBeInTheDocument();
  });

  it("the Transfer ownership flow shows translated copy and a typed-name confirm gate", () => {
    render(
      <TeamSection
        teamName="Acme"
        teamId="t-1"
        isPersonalOrg={false}
        currentRole="owner"
        currentUserId="u-owner"
        members={[owner, admin]}
        invites={[]}
        hasEmailConfigured
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    expect(
      screen.getByText(/Pick the member who will become the new owner/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New owner"), {
      target: { value: "u-admin" },
    });
    expect(
      screen.getByText("Type Bea Admin to confirm"),
    ).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Transfer ownership" });
    expect(submit).toBeDisabled();
  });

  it("the Delete team flow shows translated warning copy and gates on the typed team name", () => {
    render(
      <TeamSection
        teamName="Acme"
        teamId="t-1"
        isPersonalOrg={false}
        currentRole="owner"
        currentUserId="u-owner"
        members={[owner]}
        invites={[]}
        hasEmailConfigured
      />,
    );
    // Idle state shows the warning next to the trigger.
    expect(
      screen.getByText(/This will permanently delete all data/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Team" }));
    // Confirming state replaces it with the typed-name prompt.
    expect(screen.getByText(/Type "Acme" to confirm deletion/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Permanently Delete" }),
    ).toBeDisabled();
  });
});

describe("TeamSection — non-owner view", () => {
  it("shows the Leave team flow with translated warning copy", () => {
    render(
      <TeamSection
        teamName="Acme"
        teamId="t-1"
        isPersonalOrg={false}
        currentRole="member"
        currentUserId="u-member"
        members={[owner, member]}
        invites={[]}
        hasEmailConfigured
      />,
    );
    // Idle state shows the warning next to the trigger.
    expect(
      screen.getByText(/You will lose access to all data in this team\./),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave Team" }));
    // Confirming state replaces it with the named confirmation prompt.
    expect(
      screen.getByText("Are you sure you want to leave Acme?"),
    ).toBeInTheDocument();
  });

  it("does not render the danger zone at all for the personal org", () => {
    render(
      <TeamSection
        teamName="Personal"
        teamId="t-personal"
        isPersonalOrg={true}
        currentRole="owner"
        currentUserId="u-owner"
        members={[owner]}
        invites={[]}
        hasEmailConfigured
      />,
    );
    expect(screen.queryByText("Danger Zone")).not.toBeInTheDocument();
  });
});

const baseMembers = [owner];

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
