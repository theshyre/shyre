-- ============================================================
-- Proposals v2 — markdown body on line items (+ proposal overview)
-- ============================================================
--
-- Line items keep their STRUCTURED, machine-read fields (title, fixed_price,
-- phases, is_capped — selection, billing, and the frozen content_sha256 total
-- all depend on these). The free-form prose that used to live in the separate
-- why_it_matters / out_of_scope / definition_of_done / description columns
-- becomes ONE rendered **markdown** body, so an author can write rich scope
-- (headings, bold, lists, tables) instead of filling fixed fields.
--
--   proposal_line_items.body_markdown — per-item rich body.
--   proposals.overview_markdown       — an optional proposal-level intro /
--                                       summary shown above the line items.
--
-- Additive + backward-compatible: the legacy prose columns are LEFT IN PLACE.
-- Rendering falls back to them when body_markdown is null, and the editor
-- composes them into the markdown body on first edit — so no existing proposal
-- loses content. Markdown renders on the PUBLIC sign page, so it is always
-- rendered with react-markdown's raw-HTML OFF (no dangerouslySetInnerHTML) —
-- the SAL-039 injection lesson applied to prose.
--
-- Timestamp sorts after 20260717160000.

ALTER TABLE public.proposal_line_items
  ADD COLUMN IF NOT EXISTS body_markdown TEXT;

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS overview_markdown TEXT;

COMMENT ON COLUMN public.proposal_line_items.body_markdown IS
  'Rich item body (markdown). When set, replaces the legacy why/scope/DoD/description prose in every render. Rendered raw-HTML-off on the public sign page.';
COMMENT ON COLUMN public.proposals.overview_markdown IS
  'Optional proposal-level intro/summary (markdown), shown above the line items.';
