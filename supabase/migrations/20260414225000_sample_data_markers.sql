-- Sample data markers: flag rows created by the /admin/sample-data tool so
-- they can be removed selectively without touching real data.
--
-- RLS on these tables already scopes by user_id / organization_id, so no
-- policy changes are needed — the is_sample column is just a payload flag.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

-- Partial indexes make "delete where is_sample" and "count sample rows"
-- cheap even as the real tables grow.
CREATE INDEX IF NOT EXISTS customers_sample_idx
  ON public.customers (organization_id)
  WHERE is_sample;

CREATE INDEX IF NOT EXISTS projects_sample_idx
  ON public.projects (organization_id)
  WHERE is_sample;

CREATE INDEX IF NOT EXISTS time_entries_sample_idx
  ON public.time_entries (organization_id)
  WHERE is_sample;
