# Database Schema

> Last regenerated: 2026-05-05.
> Source of truth is the live schema (`pg_dump --schema-only`); this document is a hand-curated index that lists each table, its purpose, key columns, and the RLS shape. When live and doc disagree, live wins — open a PR fixing the doc.

All tables live in the `public` schema with **Row-Level Security (RLS) enabled**. The app is multi-tenant (team-scoped); most data tables carry a `team_id` and policies scope to it via the SECURITY DEFINER helpers `public.user_has_team_access(team_id)` and `public.user_team_role(team_id)`.

A handful of tables are **business-scoped** (a Business owns 1+ Teams) — see "Business identity" below. The shell helpers `public.user_has_business_access(business_id)` / `public.user_business_role(business_id)` derive role from the most-permissive `team_members.role` across the business's teams.

`auth.uid() = user_id` policies are **gone** as of SAL-005 (commit `5221fc1`). User-scoped tables (`user_settings`, `user_profiles`, `mfa_backup_codes`) still use that shape; everything else is team-scoped.

## Naming conventions

- `snake_case` columns; `camelCase` fields in TS interfaces.
- Module-scoped tables get a module prefix (`business_*`, `customer_*`). Exception: `expenses` is unprefixed for historical reasons (see `docs/reference/modules.md`).
- `_history` tables capture mutation events. Append-only via SECURITY DEFINER triggers; SELECT policies inherit the parent table's role gate.
- `_v` views (e.g. `customers_v`, `projects_v`) are read-side projections that the app's list pages depend on. Stable contracts.

## Identity & multi-tenancy

| Table | Scope | Purpose |
|---|---|---|
| `teams` | `team_id` PK | Tenant unit. Every member, customer, project, time entry, invoice has a `team_id`. |
| `team_members` | `(team_id, user_id)` | Role grant: `owner` / `admin` / `member`. UNIQUE on the pair. |
| `team_invites` | `(team_id, token)` | Pending invites. Email-matched on accept. |
| `team_settings` | `team_id` PK | Per-team settings: default rate, invoice prefix + counter, default tax rate, branding. |
| `team_shares` | `(parent_team_id, child_team_id)` | Cross-team data sharing — predecessor of `customer_shares`. Largely unused now; kept for legacy import paths. |
| `team_period_locks` | `(team_id, period_end)` | Bookkeeper period close. Triggers refuse mutations on locked periods. |
| `team_period_locks_history` | history | Append-only event log for lock/unlock actions. |
| `team_email_config` | `team_id` PK | Per-team Resend config + encrypted API key + daily-cap counters. SAL-018 envelope encryption. SAL-021 atomic cap RPC. SAL-025 trigger-locks the cap counter. |
| `verified_email_domains` | `(team_id, domain)` | Mirror of Resend domain verification status. SAL-024 trigger-locks `status` field. |
| `user_profiles` | `user_id` PK | Display name + avatar URL. `avatar_url` is restricted to preset:* tokens or own-folder Supabase Storage URLs (batch-2 SSRF defense). |
| `user_settings` | `user_id` PK | Per-user preferences (theme, locale, week-start, density) + integration tokens (`github_token`, `jira_api_token`). Generated `has_*_token` columns mirror presence (SAL-028). |
| `user_business_affiliations` | `(user_id, business_id)` | Optional second-degree affiliation; underused today. |
| `mfa_backup_codes` | `user_id` PK FK | Backup-code hashes for TOTP MFA. |
| `system_admins` | `user_id` PK | Bypasses team boundaries. SECURITY DEFINER predicate `is_system_admin()` is the only sane lookup (SAL-003). |

## Business identity (a Team's "issuer" for invoices)

| Table | Purpose |
|---|---|
| `businesses` | The legal entity invoices are sent under. SAL-026 locks INSERT to SECURITY DEFINER paths. |
| `businesses_history` | Append-only |
| `business_identity_private` | Tax IDs / EIN / SSN / fiscal year start. SAL-012 narrowed read access. |
| `business_identity_private_history` | Append-only |
| `business_state_registrations` | Per-state DBA / sales-tax / employer registrations. |
| `business_state_registrations_history` | Append-only |
| `business_tax_registrations` | Federal + state tax-id registry (subset of identity_private). |
| `business_registered_agents` | Per-state agent of record. |
| `business_people` | Officers / owners / employees / 1099 contractors. PII columns include compensation, equity, address. |
| `business_people_history` | Append-only |

## Customers (was "clients" pre-2026-04-14)

| Table | Purpose |
|---|---|
| `customers` | The downstream entity invoices are sent TO. `team_id`-scoped. Includes `email`, `address`, `default_rate`, `payment_terms_days`, `archived`, `bounced_at`/`complained_at` (Resend webhook flags), `imported_from`/`imported_at`/`import_run_id`. |
| `customers_v` | View used by `/customers` list page. Adds derived columns the app lists need. |
| `customer_contacts` | People at a customer org — invoice recipient list. SAL-013 narrowed RLS to team-only after a member-visibility decision. |
| `customer_shares` | Cross-team visibility of a customer (subcontracting, parent-agency consolidation). |
| `customer_permissions` | Fine-grained: per-(user OR group) `viewer`/`contributor`/`admin` on a customer. SAL-013 + batch-2 action role gates. |
| `security_groups` | Named principal sets that customer_permissions can grant to. Platform primitive. |
| `security_group_members` | `(group_id, user_id)`. |

## Projects + time + categories (Stint module)

| Table | Purpose |
|---|---|
| `projects` | Belongs to a customer (or `is_internal=true` with `customer_id IS NULL`). `default_billable`, `hourly_rate`, `category_set_id`, `extension_category_set_id`, `github_repo`, `jira_project_key`, `invoice_code`, `require_timestamps`. `2026-05-04` introduced first-class internal projects. `2026-04-30` added `parent_project_id` for sub-projects (one-level deep, trigger-enforced) — see `docs/reference/sub-projects-roadmap.md`. `2026-05-06` added recurring-budget columns: `budget_hours_per_period` + `budget_dollars_per_period` (caps), `budget_period` (`weekly`/`monthly`/`quarterly`, nullable), `budget_carryover` (`none`/`within_quarter`/`lifetime`, default `none` — only `none` enforced in v1), `budget_alert_threshold_pct` (1–100, nullable). Existing `budget_hours` repurposed as the lifetime ceiling. |
| `projects_v` | View used by `/projects` list page. |
| `time_entries` | The core unit. `start_time`/`end_time` (with generated `duration_min`), `billable`, `description`, `github_issue`, `category_id`, `project_id` (→ `team_id` enforced), `user_id`. Soft-delete via `deleted_at`. Invoice-locked entries have `invoice_id` set + cannot be edited (SAL-006). |
| `time_entries_history` | Append-only. Captures pre-invoice → post-invoice transitions. |
| `projects_history` | Append-only audit trail (added 2026-05-06). BEFORE UPDATE/DELETE trigger snapshots `to_jsonb(OLD)` so a project's pre-change state is queryable for forensic / dispute work — needed once `category_set_id` could flip mid-quarter (Option 1 of category-set switching). Owner/admin SELECT only. |
| `time_templates` | Per-user named templates that pre-fill the new-entry form. |
| `categories` | Belongs to a `category_sets` row. Per-team or system-provided. |
| `category_sets` | Group of categories that a project links to. System sets seed `software`, `meetings`, `admin`, etc.; teams can fork their own. |

## Invoices

| Table | Purpose |
|---|---|
| `invoices` | Issued documents. Status enum: `draft|sent|paid|void|overdue` (overdue is a read-time projection). Carries `team_id`, `customer_id`, denormalized `business_id` (frozen at creation), `invoice_number`, money columns (`subtotal`, `discount_amount`, `discount_rate`, `tax_rate`, `tax_amount`, `total`, `currency`), audit timestamps (`sent_at`, `paid_at`, `voided_at`), payment terms, layout options, sent-to-email summary, import-from markers. |
| `invoices_history` | Append-only event log; SAL-006/010/011 hardened the audit chain. |
| `invoice_line_items` | Per-line breakdown of a single invoice. |
| `invoice_line_items_history` | Append-only |
| `invoice_payments` | Recorded payments (manual or imported). `amount` + `currency` + `paid_on` + `paid_at` + `method` + `reference`. Currency-aware aggregation in batch-3 (bookkeeper #13). |

## Messaging / outbox (per-team email pipeline)

| Table | Purpose |
|---|---|
| `team_email_config` | (listed above) Per-team Resend config + encrypted key. |
| `verified_email_domains` | (listed above) Domain verification mirror. |
| `message_outbox` | Generic outbound queue. Carries `kind` (`invoice`/`invoice_reminder`/`payment_thanks`), `to_emails` (array), encrypted body refs, status, retry counts. |
| `message_outbox_events` | Webhook delivery events from Resend, deduped on `svix_id` (SAL-023). |
| `message_outbox_history` | Append-only log of state transitions. |

## Expenses (Business module)

| Table | Purpose |
|---|---|
| `expenses` | Team-scoped expense rows. Inline-edited via `EditableCell`. Soft-delete via `deleted_at`. Imported-from markers. Period-lock trigger applies. |

## Imports

| Table | Purpose |
|---|---|
| `import_runs` | One row per Harvest CSV upload. `triggered_by_user_id`, summary counts, `undone_at`. |

## Operations / system

| Table | Purpose |
|---|---|
| `error_logs` | Triage table. Server actions wrapped in `runSafeAction` log automatically; API routes call `logError` manually. Viewer at `/system/errors`. |
| `instance_deploy_config` | Single-row table with the Vercel API token, expiry, and deploy-hook URL. Encrypted via the same envelope scheme as Resend keys. |
| `system_admins` | (listed above) |

## Encryption envelope

Two layers: a **KEK** (key-encryption key, env var `EMAIL_KEY_ENCRYPTION_KEY` — single instance-wide AES-256 key) wraps **per-team DEKs** (data-encryption keys, generated when a team first enables the feature). Encrypted secrets in `team_email_config.api_key_encrypted` and `instance_deploy_config.api_token` are AES-256-GCM ciphertexts (12-byte IV || 16-byte auth tag || ciphertext) with the DEK.

## Notable RLS patterns

- **`user_team_role(team_id)` → 'owner' | 'admin' | 'member' | NULL.** SECURITY DEFINER. Used in dozens of policies.
- **`isTeamAdmin(role)`** TS predicate — never inline `role === 'owner' || role === 'admin'`. See `docs/reference/roles-and-permissions.md`.
- **Audit history tables** are SELECT-only for users; only SECURITY DEFINER triggers can INSERT.
- **Period-lock triggers** (`tg_invoices_period_lock`, `tg_time_entries_period_lock`, `tg_expenses_period_lock`) refuse mutations whose date falls inside a closed period.
- **SECURITY DEFINER role-transition RPCs** (`transfer_team_ownership`, `update_team_member_role`) own the role-flip writes — the `team_members.role` UPDATE path is intentionally narrow.

## Migrations directory

`supabase/migrations/*.sql` — 107 files as of 2026-05-05. Timestamps are monotonic; the latest landed file is the source of truth for next-migration naming. See `docs/reference/migrations.md` for the deploy-ordering playbook (Vercel + db-migrate.yml run in parallel, so additive vs destructive ordering matters).

## Allow-list parity

Every CHECK-constrained enum column has a TS allow-list set in the relevant module's `allow-lists.ts`. The parity test at `src/__tests__/db-parity.test.ts` enforces the two-sided contract — adding a value to the constraint requires updating the TS allow-list in the same PR (and vice versa). Coverage as of 2026-05-05: 22 paired enums.
