-- Sample-data expansion: add is_sample flags to category_sets,
-- categories, invoices, and invoice_line_items so the /admin/sample-data
-- tool can scope its cleanup precisely. Before this migration, only
-- customers / projects / time_entries / expenses carried the flag; the
-- seeder was correspondingly limited to those four entity types.
--
-- The seeder now also produces category_sets + categories (to show the
-- time-categorization surface) and invoices + invoice_line_items (to
-- show the billing surface). Cleanup queries on these columns to wipe
-- only sample-flagged rows without touching real data.
--
-- All defaults are false — existing data is untouched, and any non-
-- sample writer continues to behave as before.

ALTER TABLE public.category_sets
  ADD COLUMN is_sample BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.categories
  ADD COLUMN is_sample BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.invoices
  ADD COLUMN is_sample BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.invoice_line_items
  ADD COLUMN is_sample BOOLEAN NOT NULL DEFAULT false;
