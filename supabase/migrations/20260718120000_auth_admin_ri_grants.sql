-- Fix: GoTrue admin deleteUser 500 (SAL-050).
--
-- DIAGNOSIS (2026-07-18, reproduced end-to-end): hard-deleting an auth user
-- via the admin API returned `500 "Database error deleting user"` for EVERY
-- user — even a freshly-created probe with zero application rows — while the
-- same DELETE as `postgres` succeeded, and SOFT delete (an UPDATE) returned
-- 200. The differential: GoTrue runs as `supabase_auth_admin`, and the hard
-- DELETE fires Postgres's referential-integrity triggers for every public
-- table with a FK to auth.users — `supabase_auth_admin` held ZERO privileges
-- on those tables, so the RI action fails and the whole delete rolls back.
-- (This is the documented Supabase footgun behind "don't FK auth.users".)
--
-- FIX: grant the MINIMUM the RI action of each FK's delete rule needs:
--   ON DELETE CASCADE   → SELECT, DELETE
--   ON DELETE SET NULL  → SELECT, UPDATE
--   NO ACTION / RESTRICT → SELECT (existence check only)
-- Granted dynamically off pg_constraint so the set is exactly (and only)
-- the tables that reference auth.users at migration time. RLS still applies
-- to nothing here — RI actions run as table owner; these grants exist purely
-- so the RI machinery can plan/execute under the session role.
--
-- Forward rule (also in docs/reference/migrations.md): any NEW table with a
-- FK to auth.users must repeat the appropriate grant in its own migration.

DO $$
DECLARE
  fk RECORD;
  priv TEXT;
BEGIN
  FOR fk IN
    SELECT DISTINCT conrelid::regclass::text AS tbl, confdeltype
    FROM pg_constraint
    WHERE confrelid = 'auth.users'::regclass
      AND connamespace = 'public'::regnamespace
  LOOP
    priv := CASE fk.confdeltype
      WHEN 'c' THEN 'SELECT, DELETE'
      WHEN 'n' THEN 'SELECT, UPDATE'
      ELSE 'SELECT'
    END;
    EXECUTE format('GRANT %s ON %s TO supabase_auth_admin', priv, fk.tbl);
  END LOOP;
END $$;
