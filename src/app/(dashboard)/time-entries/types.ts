/**
 * Shared types for time-entries client components.
 */

export interface ClientRef {
  id: string;
  name: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  github_repo: string | null;
  category_set_id?: string | null;
  require_timestamps?: boolean;
  clients?: ClientRef | null;
}

export interface TimeEntry {
  id: string;
  organization_id: string;
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
}

export interface ProjectOption {
  id: string;
  name: string;
  github_repo: string | null;
  organization_id: string;
  category_set_id: string | null;
  require_timestamps: boolean;
  clients?: ClientRef | null;
}

export interface CategoryOption {
  id: string;
  category_set_id: string;
  name: string;
  color: string;
  sort_order: number;
}
