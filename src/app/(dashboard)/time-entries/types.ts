/**
 * Shared types for time-entries client components.
 */

export interface CustomerRef {
  id: string;
  name: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  github_repo: string | null;
  category_set_id?: string | null;
  require_timestamps?: boolean;
  is_internal?: boolean;
  default_billable?: boolean;
  customers?: CustomerRef | null;
}

export interface AuthorInfo {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface TimeEntry {
  id: string;
  team_id: string;
  user_id: string;
  project_id: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  duration_min: number | null;
  billable: boolean;
  github_issue: number | null;
  category_id: string | null;
  /** Linked-ticket metadata. Populated server-side on save when a
   *  Jira/GitHub reference is detected in the description. NULL
   *  when nothing matched or lookup couldn't run. */
  linked_ticket_provider: "jira" | "github" | null;
  linked_ticket_key: string | null;
  linked_ticket_url: string | null;
  linked_ticket_title: string | null;
  linked_ticket_refreshed_at: string | null;
  /** True when this entry has been billed — either via Shyre's
   *  invoice generator or a Harvest import that marked it invoiced.
   *  Renders as a lock indicator and disables editing per the DB
   *  trigger that refuses UPDATE/DELETE on invoiced rows. */
  invoiced: boolean;
  invoice_id: string | null;
  /** Resolved invoice_number for display in the lock tooltip + link
   *  to /invoices/<id>. Null when invoice_id is null. */
  invoice_number: string | null;
  projects: ProjectInfo | null;
  /** Per the mandatory authorship rule — present on every display-bound entry. */
  author: AuthorInfo | null;
}

export interface ProjectOption {
  id: string;
  name: string;
  github_repo: string | null;
  /** Atlassian project key (e.g. "AE"). Drives the description-
   *  based ticket-link detection: a key like `AE-640` in the entry
   *  description auto-attaches as `linked_ticket_provider="jira"`
   *  on save. Null when the project hasn't configured one. */
  jira_project_key: string | null;
  team_id: string;
  /** The project's base category set (system or team). */
  category_set_id: string | null;
  /** The project's extension category set, if any (category_sets.project_id
   *  = project.id). Merged with the base at picker time so the user sees
   *  built-in + project-specific categories together. */
  extension_category_set_id?: string | null;
  require_timestamps: boolean;
  /** Internal projects are pinned to billable=false; the entry forms
   *  disable the toggle when this is true. */
  is_internal?: boolean;
  /** Default for new entries on this project. Inherited at create time
   *  by createTimeEntryAction / startTimerAction / upsertTimesheetCellAction. */
  default_billable?: boolean;
  customers?: CustomerRef | null;
  /** When non-null, this project is a sub-project of the parent.
   *  Drives the indented rendering in ProjectPicker so the
   *  engagement → phase relationship reads at a glance. */
  parent_project_id?: string | null;
}

export interface CategoryOption {
  id: string;
  category_set_id: string;
  name: string;
  color: string;
  sort_order: number;
}
