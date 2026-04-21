-- Business People — employment records for the Business module.
--
-- A "person" is someone the business employs, contracts, or otherwise
-- tracks on the payroll/vendor ledger. A person MAY be linked to a
-- Shyre user account via `user_id`, but doesn't have to be — a 1099
-- contractor who sends invoices and gets paid never needs to log in.
--
-- This is NOT the user-perspective join (`user_business_affiliations`);
-- that table answers "which business does this user call home?"
-- `business_people` answers "who works for this business?" — the two
-- are orthogonal axes, and a W-2 employee who also uses Shyre has a
-- row in both.
--
-- Why not collapse into a single "people or affiliations" table:
-- the architectures pull in opposite directions. Affiliations are
-- shell-adjacent (user identity), people are module-owned (HR data).
-- See SAL-007 / docs/reference/modules.md.
--
-- Why one table instead of employees + vendors: the distinction is
-- `employment_type`, not a table boundary. Year-end 1099 reporting
-- filters to `employment_type = '1099_contractor'`; W-2 headcount
-- filters to `employment_type = 'w2_employee'`. UI presents three
-- grouped sections (Employees / Contractors / Partners & Owners) so
-- the bookkeeper's real workflow isn't a filter someone forgets to
-- apply — but the data stays in one queryable list.
--
-- Scope deliberately punts on the sensitive compliance fields (TIN,
-- SSN, W-9-on-file, withholding) — those need encryption-at-rest and
-- deserve their own PR, not a tacked-on section in the v1 schema.

CREATE TABLE public.business_people (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id               UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- Optional link to a Shyre user. When set, avatar + login email +
  -- Shyre display name come from user_profiles / auth.users via
  -- join. When null, the row stands alone (non-user contractor).
  -- ON DELETE SET NULL: deleting the user does not delete the
  -- employment record — the business still paid them, the books need
  -- that history.
  user_id                   UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Required — what the IRS / state see. Distinct from user_profiles
  -- .display_name (Shyre avatar text). "Robert Smith" on the W-2,
  -- "Bob" on the avatar. Not duplication; different semantic field.
  legal_name                TEXT NOT NULL,

  -- Optional preferred name override for UI display, e.g. a linked
  -- user who wants to be called something other than their legal
  -- name in Shyre but doesn't want to change user_profiles.display_
  -- name (which is user-owned). Most rows leave this NULL.
  preferred_name            TEXT,

  -- Payroll/HR contact. Separate from login email — a person's
  -- Shyre account may log in with gmail, while their work email is
  -- payroll@theirllc.com.
  work_email                TEXT,
  work_phone                TEXT,

  employment_type           TEXT NOT NULL CHECK (employment_type IN (
                              'w2_employee',
                              '1099_contractor',
                              'partner',
                              'owner',
                              'unpaid'
                            )),

  title                     TEXT,
  department                TEXT,
  employee_number           TEXT,

  started_on                DATE,
  ended_on                  DATE,

  compensation_type         TEXT CHECK (compensation_type IS NULL OR compensation_type IN (
                              'salary', 'hourly', 'project_based', 'equity_only', 'unpaid'
                            )),
  compensation_amount_cents INTEGER CHECK (
                              compensation_amount_cents IS NULL
                              OR compensation_amount_cents >= 0
                            ),
  compensation_currency     TEXT DEFAULT 'USD',
  compensation_schedule     TEXT CHECK (compensation_schedule IS NULL OR compensation_schedule IN (
                              'annual', 'monthly', 'biweekly', 'weekly', 'per_hour', 'per_project'
                            )),

  -- Mailing address — needed for 1099s at year-end, and often for
  -- employee records generally. Nullable fields so each line can be
  -- omitted independently (a PO-box-only address, an international
  -- contractor with no zip, etc.).
  address_line1             TEXT,
  address_line2             TEXT,
  city                      TEXT,
  state                     TEXT CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  postal_code               TEXT,
  country                   TEXT DEFAULT 'US',

  -- Optional org chart — who does this person report to. Self-
  -- reference with ON DELETE SET NULL so deleting a manager doesn't
  -- orphan their reports.
  reports_to_person_id      UUID REFERENCES public.business_people(id) ON DELETE SET NULL,

  notes                     TEXT,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ,

  -- A started-after-ended row is a data-entry mistake, not a
  -- legitimate state.
  CONSTRAINT bp_ended_after_started CHECK (
    ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on
  )
);

-- One person-record per linked user per business. Non-linked rows
-- (user_id IS NULL) are allowed in any quantity — you can track two
-- separate contractors named "John Smith" if both are real.
CREATE UNIQUE INDEX bp_one_linked_person_per_business
  ON public.business_people (business_id, user_id)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_bp_business
  ON public.business_people (business_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_bp_user
  ON public.business_people (user_id)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_bp_reports_to
  ON public.business_people (reports_to_person_id)
  WHERE reports_to_person_id IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER trg_business_people_updated_at
  BEFORE UPDATE ON public.business_people
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
--
-- Scoped via user_business_role — owner/admin of any team in the
-- business can see and edit; member-only access is read-only.
-- Linking a person to a user does NOT grant that user access —
-- access is strictly via team_members. business_people is HR data,
-- not an auth primitive.

ALTER TABLE public.business_people ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bp_select" ON public.business_people FOR SELECT
  USING (public.user_has_business_access(business_id));

CREATE POLICY "bp_insert" ON public.business_people FOR INSERT
  WITH CHECK (public.user_business_role(business_id) IN ('owner', 'admin'));

CREATE POLICY "bp_update" ON public.business_people FOR UPDATE
  USING (public.user_business_role(business_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_business_role(business_id) IN ('owner', 'admin'));

CREATE POLICY "bp_delete" ON public.business_people FOR DELETE
  USING (public.user_business_role(business_id) IN ('owner', 'admin'));
