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
  projects: ProjectInfo | null;
  /** Per the mandatory authorship rule — present on every display-bound entry. */
  author: AuthorInfo | null;
}

export interface ProjectOption {
  id: string;
  name: string;
  github_repo: string | null;
  team_id: string;
  /** The project's base category set (system or team). */
  category_set_id: string | null;
  /** The project's extension category set, if any (category_sets.project_id
   *  = project.id). Merged with the base at picker time so the user sees
   *  built-in + project-specific categories together. */
  extension_category_set_id?: string | null;
  require_timestamps: boolean;
  customers?: CustomerRef | null;
}

export interface CategoryOption {
  id: string;
  category_set_id: string;
  name: string;
  color: string;
  sort_order: number;
}
