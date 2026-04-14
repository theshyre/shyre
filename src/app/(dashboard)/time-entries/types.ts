/**
 * Shared types for time-entries client components.
 */

export interface ProjectInfo {
  id: string;
  name: string;
  github_repo: string | null;
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
  projects: ProjectInfo | null;
}

export interface ProjectOption {
  id: string;
  name: string;
  github_repo: string | null;
  organization_id: string;
}
