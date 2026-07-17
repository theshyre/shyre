-- ============================================================
-- Proposals v2 — per-item summary ("what it does for you")
-- ============================================================
--
-- A short one-line benefit statement per line item, distinct from the title
-- and the full markdown body. It populates the "What it does for you" column of
-- the auto-generated Summary table at the top of the proposal — the
-- at-a-glance pricing overview.
--
-- Additive, nullable. Timestamp sorts after 20260717170000.

ALTER TABLE public.proposal_line_items
  ADD COLUMN IF NOT EXISTS summary TEXT;

COMMENT ON COLUMN public.proposal_line_items.summary IS
  'Short one-line benefit ("what it does for you") shown in the top Summary table. Distinct from title + body_markdown.';
