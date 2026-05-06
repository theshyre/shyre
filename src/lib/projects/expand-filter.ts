/**
 * Expand a single selected project id into the full set of ids to
 * filter time entries (or reports, or any other surface that scopes
 * by project) against.
 *
 * The rollup rule: when the selected project is a parent, return
 * the parent + its leaf children so the user filtering by "the
 * engagement" sees entries logged on the engagement itself AND on
 * any of its phases. When the selected project is a leaf, just
 * return it alone — no rollup down.
 *
 * Why this lives in `lib/projects` instead of inline in each page:
 *   - `/time-entries` and `/reports` will both call it for the
 *     same query parameter, and the rule needs to stay identical
 *     across surfaces (otherwise the totals diverge);
 *   - the projects-parent triggers cap nesting at one level deep
 *     (see `docs/reference/sub-projects-roadmap.md`), so a single
 *     `.filter(p => p.parent_project_id === id)` is sufficient
 *     today — no recursive walk needed. If we ever lift the
 *     depth cap, this is the one place that needs to change.
 *
 * Robust to a project id that doesn't appear in `projects` at all
 * (returns `[selectedId]` so the caller's downstream `.in()` query
 * still works). The caller is expected to have already resolved
 * permissions / team scoping; this is purely structural.
 */

interface ProjectWithParent {
  id: string;
  parent_project_id: string | null;
}

export function expandProjectFilter(
  projects: ReadonlyArray<ProjectWithParent>,
  selectedId: string,
): string[] {
  const childIds = projects
    .filter((p) => p.parent_project_id === selectedId)
    .map((p) => p.id);
  if (childIds.length === 0) return [selectedId];
  return [selectedId, ...childIds];
}

/**
 * Whether a given project id has children — used by the picker UI
 * to render the "Includes N sub-projects" hint and to indent rows.
 * Splitting out instead of returning two values from
 * `expandProjectFilter` keeps the call sites that only need one or
 * the other from doing arr.length math.
 */
export function countSubProjects(
  projects: ReadonlyArray<ProjectWithParent>,
  selectedId: string,
): number {
  return projects.filter((p) => p.parent_project_id === selectedId).length;
}
