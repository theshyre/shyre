import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

/**
 * Audit batch D: the group-delete flow used to be an icon-only Trash
 * button gated by native `confirm()`. Rebuilt on the shared inline
 * destructive-confirm primitives per forms-and-buttons.md's tiers —
 * an empty group is cheap to recreate (inline [Confirm][Cancel] via
 * InlineDeleteButton), a group with members revokes real access for
 * real people (typed-"delete" via InlineDeleteRowConfirm).
 */

const deleteGroupMock = vi.fn();
const createGroupMock = vi.fn();
const addGroupMemberMock = vi.fn();
const removeGroupMemberMock = vi.fn();
vi.mock("./actions", () => ({
  createGroupAction: (fd: FormData) => createGroupMock(fd),
  deleteGroupAction: (fd: FormData) => deleteGroupMock(fd),
  addGroupMemberAction: (fd: FormData) => addGroupMemberMock(fd),
  removeGroupMemberAction: (fd: FormData) => removeGroupMemberMock(fd),
}));

import { SecurityGroupsSection } from "./security-groups-section";

const teams = [{ id: "t-1", name: "Acme", slug: "acme", role: "owner" as const }];

const emptyGroup = {
  id: "g-empty",
  team_id: "t-1",
  name: "Empty Group",
  description: null,
  created_at: "2026-01-01T00:00:00+00:00",
};

const staffedGroup = {
  id: "g-staffed",
  team_id: "t-1",
  name: "Staffed Group",
  description: null,
  created_at: "2026-01-01T00:00:00+00:00",
};

const groupMembers = [
  { group_id: "g-staffed", user_id: "u-1", user_profiles: { display_name: "Jamie" } },
];

const teamMembers = [
  { team_id: "t-1", user_id: "u-1", user_profiles: { display_name: "Jamie" } },
  { team_id: "t-1", user_id: "u-2", user_profiles: { display_name: "Robin" } },
];

beforeEach(() => {
  deleteGroupMock.mockReset();
  createGroupMock.mockReset();
  addGroupMemberMock.mockReset();
  removeGroupMemberMock.mockReset();
});

describe("SecurityGroupsSection — destructive delete tiers", () => {
  it("an empty group deletes via the cheap inline [Confirm][Cancel] tier (InlineDeleteButton)", async () => {
    deleteGroupMock.mockResolvedValue({ success: true });
    renderWithIntl(
      <SecurityGroupsSection
        teams={teams}
        groups={[emptyGroup]}
        groupMembers={[]}
        teamMembers={teamMembers}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Delete Empty Group" });
    fireEvent.click(trigger);
    // InlineDeleteButton's confirm step shows the group name as the
    // confirmDescription (alongside the card header, hence >=2) plus
    // a red Delete button — not a typed input.
    expect(screen.getAllByText("Empty Group").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByLabelText(/type delete to confirm/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(deleteGroupMock).toHaveBeenCalledTimes(1));
    const fd = deleteGroupMock.mock.calls[0]![0] as FormData;
    expect(fd.get("group_id")).toBe("g-empty");
    expect(fd.get("team_id")).toBe("t-1");
  });

  it("a group WITH members requires typing 'delete' (InlineDeleteRowConfirm) — the button stays disabled until then", async () => {
    deleteGroupMock.mockResolvedValue({ success: true });
    renderWithIntl(
      <SecurityGroupsSection
        teams={teams}
        groups={[staffedGroup]}
        groupMembers={groupMembers}
        teamMembers={teamMembers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Staffed Group" }));
    // The typed-confirm surface names the group + member count.
    const confirmGroup = screen.getByRole("group", {
      name: "Delete Staffed Group",
    });
    expect(confirmGroup).toHaveTextContent("Staffed Group");
    expect(confirmGroup).toHaveTextContent("1 member");

    const confirmButton = screen.getByRole("button", { name: "Confirm delete" });
    expect(confirmButton).toBeDisabled();

    const typedInput = screen.getByLabelText(/type delete to confirm/i);
    fireEvent.change(typedInput, { target: { value: "delete" } });
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    await waitFor(() => expect(deleteGroupMock).toHaveBeenCalledTimes(1));
    const fd = deleteGroupMock.mock.calls[0]![0] as FormData;
    expect(fd.get("group_id")).toBe("g-staffed");
  });

  it("cancelling the inline confirm on an empty group does not call the delete action", () => {
    renderWithIntl(
      <SecurityGroupsSection
        teams={teams}
        groups={[emptyGroup]}
        groupMembers={[]}
        teamMembers={teamMembers}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Empty Group" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteGroupMock).not.toHaveBeenCalled();
    // Trigger is back — the original trash button re-appears.
    expect(
      screen.getByRole("button", { name: "Delete Empty Group" }),
    ).toBeInTheDocument();
  });

  it("a delete failure surfaces inline via AlertBanner, not a silent no-op", async () => {
    deleteGroupMock.mockResolvedValue({
      success: false,
      error: { message: "Only owners and admins can delete groups." },
    });
    renderWithIntl(
      <SecurityGroupsSection
        teams={teams}
        groups={[emptyGroup]}
        groupMembers={[]}
        teamMembers={teamMembers}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Empty Group" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() =>
      expect(
        screen.getByText("Only owners and admins can delete groups."),
      ).toBeInTheDocument(),
    );
  });

  it("renders the empty-groups message when there are no groups", () => {
    renderWithIntl(
      <SecurityGroupsSection
        teams={teams}
        groups={[]}
        groupMembers={[]}
        teamMembers={teamMembers}
      />,
    );
    expect(
      screen.getByText("No security groups yet. Create one to get started."),
    ).toBeInTheDocument();
  });

  it("the New group trigger opens the create form and Escape-free Cancel closes it", () => {
    renderWithIntl(
      <SecurityGroupsSection
        teams={teams}
        groups={[]}
        groupMembers={[]}
        teamMembers={teamMembers}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Create Group/ }));
    expect(screen.getByLabelText(/Group Name/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(/Group Name/)).toBeNull();
  });
});
