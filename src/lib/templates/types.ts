/**
 * Types for time templates (Phase 4).
 */

export interface TimeTemplate {
  id: string;
  team_id: string;
  user_id: string;
  project_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  billable: boolean;
  sort_order: number;
  last_used_at: string | null;
  created_at: string;
}
