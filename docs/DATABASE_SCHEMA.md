# Database Schema

All tables live in the `public` schema with Row-Level Security (RLS) enabled. The app is **multi-tenant** — data tables have an `organization_id` column and RLS policies check org membership via `user_has_org_access(org_id)`.

## Multi-tenancy

### `organizations`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | `gen_random_uuid()` |
| name | TEXT | Required |
| slug | TEXT | Unique, auto-generated |
| created_at | TIMESTAMPTZ | |

### `organization_members`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| organization_id | UUID | References `organizations(id)` CASCADE |
| user_id | UUID | References `auth.users(id)` CASCADE |
| role | TEXT | `owner\|admin\|member` |
| joined_at | TIMESTAMPTZ | |

Unique constraint on `(organization_id, user_id)`.

### `organization_invites`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| organization_id | UUID | References `organizations(id)` CASCADE |
| email | TEXT | Invitee email |
| role | TEXT | `admin\|member` |
| invited_by | UUID | References `auth.users(id)` |
| token | TEXT | Unique, auto-generated |
| expires_at | TIMESTAMPTZ | Default: 7 days |
| accepted_at | TIMESTAMPTZ | NULL until accepted |

### Helper functions
- `user_has_org_access(org_id)` — returns true if `auth.uid()` is a member of the org
- `user_org_role(org_id)` — returns the user's role in the org

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
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | Auto-updated via trigger |

### `clients`
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
| created_at | TIMESTAMPTZ | |

### `category_sets`
Templates of time categories. System sets (`is_system=true`, `organization_id=NULL`) are seeded and visible to all users. Org sets are user-created copies or custom sets.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | |
| organization_id | UUID | References `organizations(id)` CASCADE; NULL for system sets |
| name | TEXT | Required, unique per org |
| description | TEXT | |
| is_system | BOOLEAN | True for built-in templates |
| created_by | UUID | References `auth.users(id)` |
| created_at | TIMESTAMPTZ | |

Check: `is_system` ↔ `organization_id IS NULL` (system sets have no org; org sets have one).

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

### `invoices`
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
