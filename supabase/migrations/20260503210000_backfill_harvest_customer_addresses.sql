-- Backfill: Harvest-imported customer addresses dumped into a single
-- plain-text blob get re-parsed into Shyre's structured address JSON.
--
-- Bug history: buildCustomerRow in harvest-import-logic.ts wrote
-- Harvest's multi-line freeform `address` field straight into
-- customers.address. deserializeAddress() then fell through to its
-- plain-text fallback — the whole string lands in `street`, the
-- newline collapses in the customer detail form's single input, and
-- the user sees "6119 Canter LnWest Linn, OR 97068" with city / state
-- / zip empty.
--
-- The importer is fixed (writes structured JSON via
-- parseHarvestAddressForStorage). This migration re-parses rows that
-- were imported BEFORE the fix landed.
--
-- Scope: only rows that
--   1. came from Harvest (`imported_from = 'harvest'`),
--   2. have a non-null address, AND
--   3. don't already look like JSON (don't start with `{`).
--
-- Conservative pattern match: only the canonical US 2-line shape
--   <street>
--   <city>, <state> <postal>
-- gets rewritten. Anything outside the pattern (international,
-- multi-suite, missing comma) is LEFT ALONE so we don't truncate
-- data we can't safely structure. Those rows stay legacy-shape;
-- the UI's deserializeAddress already handles them as "everything
-- in street" — visually unchanged, no regression. Affected users
-- can re-edit manually or re-run the import (upsert by
-- import_source_id).
--
-- Idempotent — running twice is a no-op (the WHERE clauses gate
-- on the legacy shape).

UPDATE public.customers
SET address = jsonb_build_object(
    'street',     btrim(split_part(address, E'\n', 1)),
    'street2',    '',
    'city',       btrim((regexp_match(split_part(address, E'\n', 2), '^([^,]+?)\s*,\s*([A-Za-z][A-Za-z .''-]{0,40}?)\s+([A-Za-z0-9][A-Za-z0-9 -]{2,11})$'))[1]),
    'state',      btrim((regexp_match(split_part(address, E'\n', 2), '^([^,]+?)\s*,\s*([A-Za-z][A-Za-z .''-]{0,40}?)\s+([A-Za-z0-9][A-Za-z0-9 -]{2,11})$'))[2]),
    'postalCode', btrim((regexp_match(split_part(address, E'\n', 2), '^([^,]+?)\s*,\s*([A-Za-z][A-Za-z .''-]{0,40}?)\s+([A-Za-z0-9][A-Za-z0-9 -]{2,11})$'))[3]),
    'country',    ''
)::text
WHERE imported_from = 'harvest'
  AND address IS NOT NULL
  AND address NOT LIKE '{%'
  -- Only the canonical 2-line "street \n city, state postal" shape.
  AND array_length(regexp_split_to_array(address, E'\n'), 1) = 2
  AND split_part(address, E'\n', 2) ~ '^[^,]+?\s*,\s*[A-Za-z][A-Za-z .''-]{0,40}?\s+[A-Za-z0-9][A-Za-z0-9 -]{2,11}$';

-- Note: we don't touch the `imported_at` / `import_run_id` columns —
-- the row's lineage stays. Only the shape of `address` changes.
