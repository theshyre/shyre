/**
 * Shared expense-surface types — the neutral home for shapes that
 * both the Business module's expense pages and the Projects module's
 * expense surfaces (plus the shared components under
 * `src/components/expenses/`) rely on.
 *
 * Previously `ProjectOption` was exported from the Business expenses
 * `page.tsx`, which forced every cross-module consumer to import out
 * of another module's directory. Types only — no runtime code.
 */

/** A pickable project for expense linking — drives the project
 *  dropdown in the create form, the per-row inline project cell,
 *  and the bulk project picker. `team_id` is required so pickers
 *  can scope the list to the team the expense is charged to. */
export interface ProjectOption {
  id: string;
  name: string;
  team_id: string;
}
