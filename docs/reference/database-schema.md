# Database Schema

All tables live in the `public` schema with Row-Level Security (RLS) enabled. The app is **multi-tenant** — data tables have an `team_id` column and RLS policies check org membership via `user_has_org_access(team_id)`.

## Multi-tenancy

### `teams`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | `gen_random_uuid()` |
| name | TEXT | Required |
| slug | TEXT | Unique, auto-generated |
| created_at | TIMESTAMPTZ | |

### `team_members`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| team_id | UUID | References `teams(id)` CASCADE |
| user_id | UUID | References `auth.users(id)` CASCADE |
| role | TEXT | `owner\|admin\|member` |
| joined_at | TIMESTAMPTZ | |

Unique constraint on `(team_id, user_id)`.

### `team_invites`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| team_id | UUID | References `teams(id)` CASCADE |
| email | TEXT | Invitee email |
| role | TEXT | `admin\|member` |
| invited_by | UUID | References `auth.users(id)` |
| token | TEXT | Unique, auto-generated |
| expires_at | TIMESTAMPTZ | Default: 7 days |
| accepted_at | TIMESTAMPTZ | NULL until accepted |

### Helper functions
- `user_has_team_access(team_id)` — returns true if `auth.uid()` is a member of the team
- `user_team_role(team_id)` — returns the user's role in the team
- `user_has_business_access(business_id)` — true if the user is a member of any team owned by the business
- `user_business_role(business_id)` — max role (`owner` > `admin` > `member`) across team memberships in the business

## Businesses

### `businesses`
Legal business entity. Owns one or more teams. Identity columns are all nullable — a brand-new business exists as a shell until the user fills in legal details.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| name | TEXT | Display name (may differ from legal_name) |
| legal_name | TEXT | Registered legal name as filed with the state |
| entity_type | TEXT | `sole_prop\|llc\|s_corp\|c_corp\|partnership\|nonprofit\|other` |
| tax_id | TEXT | EIN or equivalent |
| date_incorporated | DATE | |
| fiscal_year_start | TEXT | MM-DD format |
| created_at, updated_at | TIMESTAMPTZ | |

`teams.business_id` references `businesses(id)` NOT NULL — every team belongs to exactly one business. A trigger blocks `UPDATE teams SET business_id` once the team has invoices or expenses.

### `user_business_affiliations`
A user's "home business" — who they are employed by or contract through. Informational identity, not authorization (auth is derived from `team_members`).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| user_id | UUID | References `auth.users(id)` CASCADE |
| business_id | UUID | References `businesses(id)` CASCADE |
| affiliation_role | TEXT | `owner\|employee\|contractor\|partner` |
| is_primary | BOOLEAN | Partial unique index enforces one primary per user |
| started_on, ended_on | DATE | Optional |
| notes | TEXT | |

### `business_state_registrations`
Every state where the business is formed or foreign-qualified. Symmetric model — formation and foreign qualifications live in the same table, distinguished by `is_formation`.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| business_id | UUID | References `businesses(id)` CASCADE |
| state | TEXT | Two-letter USPS code |
| is_formation | BOOLEAN | Partial unique index: exactly one formation per business |
| registration_type | TEXT | `domestic\|foreign_qualification` |
| entity_number | TEXT | State-assigned filing number |
| state_tax_id | TEXT | Distinct from EIN in some states |
| registered_on | DATE | State approval date |
| nexus_start_date | DATE | When the business first had nexus — defends late-registration penalties |
| registration_status | TEXT | `pending\|active\|delinquent\|withdrawn\|revoked` |
| withdrawn_on, revoked_on | DATE | Required when status is `withdrawn` / `revoked` (CHECK constraint) |
| report_frequency | TEXT | `annual\|biennial\|decennial` |
| due_rule | TEXT | `fixed_date\|anniversary\|quarter_end` |
| annual_report_due_mmdd | TEXT | MM-DD |
| next_due_date | DATE | Currently user-maintained |
| annual_report_fee_cents | INTEGER | Cents, never float |
| registered_agent_id | UUID | References `business_registered_agents(id)` SET NULL |
| notes | TEXT | |
| deleted_at | TIMESTAMPTZ | Soft delete |

### `business_tax_registrations`
Sales/use tax and similar tax-specific registrations. Separate from state registrations because filing cadence and ID scheme differ.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| business_id | UUID | References `businesses(id)` CASCADE |
| state | TEXT | Two-letter USPS code |
| tax_type | TEXT | `sales_use\|seller_use\|consumer_use\|gross_receipts` |
| permit_number | TEXT | |
| tax_registration_status | TEXT | `pending\|active\|delinquent\|closed` |
| filing_frequency | TEXT | `monthly\|quarterly\|annual\|semi_annual` |
| registered_on, nexus_start_date, closed_on, next_filing_due | DATE | |
| notes | TEXT | |
| deleted_at | TIMESTAMPTZ | Soft delete |

### `business_registered_agents`
Structured address for each registered agent. One agent commonly serves one business across many states.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| business_id | UUID | References `businesses(id)` CASCADE |
| name | TEXT | |
| address_line1, city, state, postal_code, country | TEXT | Structured address — filings rejected on formatting |
| address_line2 | TEXT | Optional |
| contact_email, contact_phone | TEXT | Optional |
| notes | TEXT | |
| deleted_at | TIMESTAMPTZ | Soft delete |

## Tables

### `user_settings`
One row per user, auto-created on signup via trigger.

| Column | Type | Notes |
|--------|------|-------|
| user_id | UUID (PK) | References `auth.users(id)` |
| business_name | TEXT | |
| business_email | TEXT | |
| business_address | TEXT | |
| business_phone | TEXT | |
| logo_url | TEXT | Supabase Storage URL |
| default_rate | NUMERIC(10,2) | Default: 0 |
| invoice_prefix | TEXT | Default: 'INV' |
| invoice_next_num | INTEGER | Default: 1 |
| tax_rate | NUMERIC(5,2) | Default: 0 |
| github_token | TEXT | Encrypted, PAT for GitHub API |
| preferred_theme | TEXT | `system\|light\|dark\|high-contrast`. NULL = follow system |
| timezone | TEXT | IANA name (e.g. `America/Los_Angeles`). NULL = browser-detected |
| locale | TEXT | `en\|es`. NULL = app default (en) |
| week_start | TEXT | `monday\|sunday`. NULL = monday (ISO) |
| time_format | TEXT | `12h\|24h`. NULL = locale default |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | Auto-updated via trigger |

### `customers` (renamed from `clients`)
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | `gen_random_uuid()` |
| user_id | UUID | References `auth.users(id)` |
| name | TEXT | Required |
| email | TEXT | |
| address | TEXT | |
| notes | TEXT | |
| default_rate | NUMERIC(10,2) | Hourly rate |
| created_at | TIMESTAMPTZ | |
| archived | BOOLEAN | Default: false |

### `projects`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| client_id | UUID | References `clients(id)` CASCADE |
| user_id | UUID | References `auth.users(id)` |
| name | TEXT | Required |
| description | TEXT | |
| hourly_rate | NUMERIC(10,2) | Overrides client rate |
| budget_hours | NUMERIC(10,2) | Optional cap |
| github_repo | TEXT | `owner/repo` format |
| status | TEXT | `active\|paused\|completed\|archived` |
| category_set_id | UUID | References `category_sets(id)` SET NULL — optional category template |
| require_timestamps | BOOLEAN | Default true. When false, entries need only date + duration (no explicit start/end). |
| created_at | TIMESTAMPTZ | |

### `time_entries`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| user_id | UUID | |
| project_id | UUID | References `projects(id)` CASCADE |
| description | TEXT | |
| start_time | TIMESTAMPTZ | Required |
| end_time | TIMESTAMPTZ | NULL while timer running |
| duration_min | INTEGER | Generated: `EXTRACT(EPOCH FROM (end - start)) / 60` |
| billable | BOOLEAN | Default: true |
| github_issue | INTEGER | GitHub issue number |
| category_id | UUID | References `categories(id)` SET NULL — trigger enforces set matches project |
| invoiced | BOOLEAN | Default: false |
| invoice_id | UUID | References `invoices(id)` SET NULL |
| deleted_at | TIMESTAMPTZ | Soft delete. NULL for active entries; set to `now()` when trashed. Normal listings, reports, invoicing, and exports must include `WHERE deleted_at IS NULL`. The `/time-entries/trash` view reads rows where it's NOT NULL. RLS is unchanged — the owner can read, restore, or permanently delete their own trashed rows. |
| created_at | TIMESTAMPTZ | |

Partial indexes:
- `idx_time_entries_active_start_time (user_id, start_time) WHERE deleted_at IS NULL` — fast week/day listings without paying for trashed rows.
- `idx_time_entries_deleted_at (user_id, deleted_at DESC) WHERE deleted_at IS NOT NULL` — fast trash queries.

### `category_sets`
Templates of time categories. System sets (`is_system=true`, `team_id=NULL`) are seeded and visible to all users. Org sets are user-created copies or custom sets.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| team_id | UUID | References `teams(id)` CASCADE; NULL for system sets |
| name | TEXT | Required, unique per org |
| description | TEXT | |
| is_system | BOOLEAN | True for built-in templates |
| created_by | UUID | References `auth.users(id)` |
| created_at | TIMESTAMPTZ | |

Check: `is_system` ↔ `team_id IS NULL` (system sets have no org; org sets have one).

### `categories`
Individual categories within a set.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| category_set_id | UUID | References `category_sets(id)` CASCADE |
| name | TEXT | Required, unique per set |
| color | TEXT | Hex color, default `#6b7280` |
| sort_order | INTEGER | Default 0 |
| created_at | TIMESTAMPTZ | |

### `time_templates`
Saved (project + category + description + billable) combos for one-click timer starts. Scoped to the owning user within an org.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| team_id | UUID | References `teams(id)` CASCADE |
| user_id | UUID | References `auth.users(id)` CASCADE |
| project_id | UUID | References `projects(id)` CASCADE |
| category_id | UUID | References `categories(id)` SET NULL |
| name | TEXT | Display name; unique per (user, org) |
| description | TEXT | Pre-filled into the started entry |
| billable | BOOLEAN | Default true |
| sort_order | INTEGER | Default 0 |
| last_used_at | TIMESTAMPTZ | Updated when template is used |
| created_at | TIMESTAMPTZ | |

### `invoices`
Carries a denormalized `business_id` (NOT NULL) set at creation time via trigger from `teams.business_id`. Invoices are legal documents; issuer must be stable even if the team is re-parented later.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| user_id | UUID | |
| client_id | UUID | References `clients(id)` |
| invoice_number | TEXT | Auto-generated, e.g. `INV-2026-001` |
| issued_date | DATE | |
| due_date | DATE | |
| status | TEXT | `draft\|sent\|paid\|overdue\|void` |
| subtotal | NUMERIC(10,2) | |
| tax_rate | NUMERIC(5,2) | |
| tax_amount | NUMERIC(10,2) | |
| total | NUMERIC(10,2) | |
| notes | TEXT | |
| created_at | TIMESTAMPTZ | |

### `invoice_line_items`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| invoice_id | UUID | References `invoices(id)` CASCADE |
| description | TEXT | Required |
| quantity | NUMERIC(10,2) | Hours |
| unit_price | NUMERIC(10,2) | Rate |
| amount | NUMERIC(10,2) | quantity * unit_price |
| time_entry_id | UUID | References `time_entries(id)` SET NULL |

## RLS Policies

Every table uses `FOR ALL` policies scoped to `auth.uid() = user_id`. Exception: `invoice_line_items` uses a subquery to check the parent invoice's `user_id`.

## Triggers

- `on_auth_user_created` — Auto-creates `user_settings` row on signup
- `user_settings_updated_at` — Updates `updated_at` on settings changes

## Indexes

Indexes exist on all foreign key columns plus `time_entries.start_time` for efficient date range queries.
