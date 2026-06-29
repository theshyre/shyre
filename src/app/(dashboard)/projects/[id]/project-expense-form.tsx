"use client";

import { NewExpenseForm } from "@/app/(dashboard)/business/[businessId]/expenses/new-expense-form";

interface Props {
  /** The project's team — used as the hidden team_id on submit.
   *  The project page only ever surfaces a single-team form here:
   *  expenses inherit the project's team (FK on projects.team_id
   *  would reject a cross-team write anyway). */
  teamId: string;
  teamName: string;
  /** Hidden under the form — the picker is suppressed via
   *  NewExpenseForm's `lockedProjectId` prop and project_id is
   *  emitted as a hidden field. */
  projectId: string;
  /** Distinct prior vendors across the project's team → native
   *  <datalist> suggestions on the vendor input. Free text still
   *  accepted. */
  vendorOptions: string[];
}

/**
 * Project-scoped wrapper around the shared NewExpenseForm. Locks
 * the project picker to this project (no point in offering "none"
 * or "other project" on a project detail page — the user came here
 * BECAUSE they're working on it) and pins the team to the project's
 * own team. Reusing the underlying form keeps validation, error
 * surfacing, autosave UX, and the `N` shortcut consistent with the
 * main /business/[id]/expenses surface.
 */
export function ProjectExpenseForm({
  teamId,
  teamName,
  projectId,
  vendorOptions,
}: Props): React.JSX.Element {
  return (
    <NewExpenseForm
      defaultTeamId={teamId}
      teamOptions={[{ id: teamId, name: teamName }]}
      projects={[]}
      vendorOptions={vendorOptions}
      lockedProjectId={projectId}
    />
  );
}
