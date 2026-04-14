/**
 * Types for time categories (Phase 2).
 */

export interface CategorySet {
  id: string;
  organization_id: string | null;
  name: string;
  description: string | null;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
}

export interface Category {
  id: string;
  category_set_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
}

export interface CategorySetWithCategories extends CategorySet {
  categories: Category[];
}
