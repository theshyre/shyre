/**
 * Field-label map + hidden-key set for `projects_history` rows.
 *
 * Mirrors the shape of FIELD_LABELS / HIDDEN_KEYS in
 * `business/[businessId]/people/history/history-format.ts` so the
 * shared `expandWithFieldDiffs` helper can run against project rows
 * without modification — it accepts these as pluggable inputs.
 *
 * Anything not in `PROJECT_FIELD_LABELS` is hidden. Add labels here
 * when surfacing a new column to the audit timeline.
 */

export const PROJECT_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  description: "Description",
  hourly_rate: "Hourly rate",
  budget_hours: "Budget (hours)",
  github_repo: "GitHub repo",
  jira_project_key: "Jira project key",
  invoice_code: "Invoice code",
  status: "Status",
  category_set_id: "Category set",
  extension_category_set_id: "Project-scoped category set",
  require_timestamps: "Require timestamps",
  default_billable: "Default billable",
  customer_id: "Customer",
  parent_project_id: "Parent project",
  is_internal: "Internal project",
  time_entries_visibility: "Time-entries visibility",
};

/**
 * Columns we filter out of the "previous values" enumeration shown
 * on the most-recent (no newer-neighbor) row. These don't help a
 * reader understand the change — internal ids, audit timestamps,
 * the user_id column that mirrors a project's creator (covered by
 * the changed-by stamp).
 */
export const PROJECT_HISTORY_HIDDEN_KEYS = new Set([
  "id",
  "team_id",
  "user_id",
  "created_at",
  "updated_at",
  "updated_by_user_id",
]);

export interface ProjectHistoryEntry {
  id: string;
  operation: "UPDATE" | "DELETE";
  changedAt: string;
  changedBy: {
    userId: string | null;
    displayName: string | null;
  };
  previousState: Record<string, unknown>;
}
