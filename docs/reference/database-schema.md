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
| `team_settings` | `team_id` PK | Per-team settings: default rate, invoice prefix + counter, default tax rate, branding (`wordmark_primary`/`wordmark_secondary`, `brand_color`, and `logo_url` — an uploaded logo in the public `branding` Storage bucket, activated by `20260717140000`; rendered on the proposal PDF + sign page. Writes validated by `isOwnBrandingUrl` to be the team's own upload — the SAL-039 image lesson, SAL-041). |
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
| `business_identity_private` | Tax IDs / EIN / SSN / D-U-N-S Number / fiscal year start. SAL-012 narrowed read access. |
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
| `projects` | Belongs to a customer (or `is_internal=true` with `customer_id IS NULL`). `default_billable`, `hourly_rate`, `category_set_id`, `extension_category_set_id`, `github_repo`, `jira_project_key`, `invoice_code`, `require_timestamps`. `2026-05-04` introduced first-class internal projects. `2026-04-30` added `parent_project_id` for sub-projects (one-level deep, trigger-enforced) — see `docs/reference/sub-projects-roadmap.md`. `2026-05-06` added recurring-budget columns: `budget_hours_per_period` + `budget_dollars_per_period` (caps), `budget_period` (`weekly`/`monthly`/`quarterly`, nullable), `budget_carryover` (`none`/`within_quarter`/`lifetime`, default `none` — only `none` enforced in v1), `budget_alert_threshold_pct` (1–100, nullable). Existing `budget_hours` repurposed as the lifetime ceiling. `2026-06-30` added lifecycle dates: `projected_end_date` (DATE, planning-only — drives the "overdue" badge, never a financial total), `closed_at` (TIMESTAMPTZ, the close-out moment) + `closed_by_user_id` (FK `auth.users`). `closed_at` is coupled to status by CHECK `projects_closed_at_requires_terminal_status` (non-null only for `completed`/`archived`) and maintained by the `tg_projects_stamp_closed_at` trigger; `tg_projects_block_close_with_open_children` rejects closing a parent with open sub-projects. **Close-out reuses the `completed` status — no new status value.** |
| `projects_v` | View used by `/projects` list page; tail-appends `projected_end_date`, `closed_at`, `closed_by_user_id` (not rate-gated). |
| `time_entries` | The core unit. `start_time`/`end_time` (with generated `duration_min`), `billable`, `description`, `github_issue`, `category_id`, `project_id` (→ `team_id` enforced), `user_id`. Soft-delete via `deleted_at`. Invoice-locked entries have `invoice_id` set + cannot be edited (SAL-006). |
| `time_entries_history` | Append-only. Captures pre-invoice → post-invoice transitions. |
| `projects_history` | Append-only audit trail (added 2026-05-06). BEFORE UPDATE/DELETE trigger snapshots `to_jsonb(OLD)` so a project's pre-change state is queryable for forensic / dispute work — needed once `category_set_id` could flip mid-quarter (Option 1 of category-set switching). Owner/admin SELECT only. |
| `time_templates` | Per-user named templates that pre-fill the new-entry form. |
| `categories` | Belongs to a `category_sets` row. Per-team or system-provided. |
| `category_sets` | Group of categories that a project links to. System sets seed `software`, `meetings`, `admin`, etc.; teams can fork their own. |

## Invoices

| Table | Purpose |
|---|---|
| `invoices` | Issued documents. Status enum: `draft|sent|paid|void|overdue` (overdue is a read-time projection). Carries `team_id`, `customer_id`, denormalized `business_id` (frozen at creation), nullable `proposal_id` → `proposals` (ON DELETE SET NULL — the sign-off this bill came from, for reconciliation), `invoice_number`, money columns (`subtotal`, `discount_amount`, `discount_rate`, `tax_rate`, `tax_amount`, `total`, `currency`), audit timestamps (`sent_at`, `paid_at`, `voided_at`), payment terms, layout options, sent-to-email summary, import-from markers. |
| `invoices_history` | Append-only event log; SAL-006/010/011 hardened the audit chain. |
| `invoice_line_items` | Per-line breakdown of a single invoice. Source FKs (ON DELETE SET NULL): `time_entry_id` (1:1 when a line collapses one entry; null for grouped lines), `expense_id` (1:1 to `expenses` when the line came from a billable expense — phase 2), `proposal_line_item_id` (1:1 to `proposal_line_items` when the line bills a signed fixed-price item — billing-correctness pass). CHECK `invoice_line_items_source_mutex` enforces at most **one** of the three FKs is non-null (all null = manual/ad-hoc line). Deleting a line clears the linked proposal item's `invoiced_at` via `trg_ili_release_proposal_lock`. |
| `invoice_line_items_history` | Append-only |
| `invoice_payments` | Recorded payments (manual or imported). `amount` + `currency` + `paid_on` + `paid_at` + `method` + `reference`. Currency-aware aggregation in batch-3 (bookkeeper #13). |

## Proposals

| Table | Purpose |
|---|---|
| `proposals` | Fixed-price quotes — the front of the funnel (draft → sent → viewed → accepted/declined → converted, plus `superseded` for replaced versions; timestamps trigger-stamped on first transition). Carries `team_id`, `user_id` (prepared-by), `customer_id`, `signer_contact_id` → `customer_contacts`, optional `business_id`, `proposal_number` (unique per team, from `team_settings.proposal_prefix`/`proposal_next_num`), terms (`payment_terms_days`+`label`, `deposit_type` `none\|percent\|amount` + `deposit_value`, `warranty_days`, `terms_notes`), versioning (`version_number`, `supersedes_proposal_id`, `superseded_at` — stamped by the status-timestamp trigger when a version is replaced), `accepted_total`. Owner/admin-only RLS (invoice tier). |
| `proposals_history` | Append-only; SECURITY DEFINER trigger writes only. |
| `proposal_line_items` | A line item = a proposed project with a `fixed_price`. `parent_line_item_id` self-ref (one level) models phases — phase prices sum to the parent's price, `is_capped` marks the total as a hard cap (action-layer enforced; DB guard is a P4 hardening). `converted_project_id` + `invoiced_at` land with the convert/billing phases. Only top-level rows are client-selectable at sign-off. |
| `proposal_line_items_history` | Append-only |

| `proposal_access_tokens` | The public sign-link identity (SAL-036): sha256 `token_hash` (raw only in the emailed URL), frozen `signer_email`/`signer_name`, 30-day `expires_at`, `consumed_at` (one decision per link), `first_viewed_at`, and OTP state (`otp_code_hash` bound to the token row, `otp_expires_at`, `otp_attempts` with 5-try lockout, `otp_verified_at`). Owner/admin SELECT; writes only via the server-side admin client. |
| `proposal_events` | Append-only forward lifecycle log (`created\|sent\|viewed\|otp_sent\|otp_verified\|otp_failed\|accepted\|declined\|countersigned\|converted\|superseded`). Signer-side events carry NULL `actor_user_id` + an `actor_label`. Owner/admin SELECT; admin-client writes only. |
| `proposal_acceptances` | Immutable decision record: signer name/title/email, `signature_typed`, `selected_line_item_ids`, full `content_snapshot` + `content_sha256` ("what exactly was accepted"), server-computed `accepted_total`, `tax_rate` (the team rate **frozen at signing** — billing uses this, not the live default, so a rate change between sign-off and invoice can't move the client's total), IP/UA, `otp_verified_at`, provider counter-signature columns. No client write policies at all. |

Send-locks: `trg_guard_proposals_send_lock` / `trg_guard_pli_send_lock` freeze content (default-deny jsonb strip-list) once a proposal leaves `draft`; lifecycle columns and P3's convert/billing stamps stay writable. The `/sign/<token>` route is exempted from the auth middleware — see SAL-036 for the full public-surface posture.

P4 hardening (`20260716170000_proposals_p4_hardening.sql`): `proposal_otp_attempt(token_id)` — the ATOMIC OTP attempt increment (SAL-037; keep the hardcoded 5 in lockstep with `MAX_OTP_ATTEMPTS`); `uq_proposal_acceptances_proposal` — one decision record per proposal (SAL-038); statement-level `trg_z_pli_phase_sums_*` triggers — every phased item's phases must sum exactly to its fixed price (DB backstop over the action-layer rule).

Draft leniency (`20260717130000_proposals_draft_leniency.sql`): save-as-you-go. The `trg_z_pli_phase_sums_*` triggers now **exempt `draft` proposals** (a WIP draft may hold a mismatched breakdown); the phase-sum guarantee is enforced instead at the draft → non-draft transition by `trg_proposals_phase_sums_on_send` (BEFORE UPDATE on `proposals`), which also catches a raw status flip. The author-facing completeness gate (title, ≥1 item, signer) lives in `proposalSendReadiness` at the action layer + the detail-page checklist.

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
| `expenses` | Team-scoped expense rows. Inline-edited via `EditableCell`. Soft-delete via `deleted_at`. Imported-from markers. Period-lock trigger applies. `external_reference` (text, nullable) is the expense's **external** identifier — vendor invoice #, PO #, order/receipt/confirmation number; free text, not unique (split receipts share one), distinct from the internal `invoice_id` linkage. Phase 2: `invoiced` (bool), `invoice_id` (FK to `invoices`, ON DELETE SET NULL), `invoiced_at` (timestamptz) carry the same invoiced-lock pattern as `time_entries` — action layer refuses update/delete/split when `invoiced=true`. |

**Naming convention — `external_reference`.** The "an outside party's identifier for this record" concept is named `external_reference` (not `reference` / `ext_ref` / `reference_no`). It currently lives only on `expenses`; if a future column carries the same idea on `time_entries` or `invoices`, reuse this exact name rather than inventing a synonym. Free text, no CHECK / allow-list — it is a vendor-defined namespace, not a Shyre taxonomy.

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

## Realtime team broadcast (live dashboard freshness)

Migration `20260716120000_realtime_team_broadcast.sql`. A `SECURITY DEFINER`
trigger `public.broadcast_team_change()` on `time_entries`, `invoices`, and
`expenses` emits a **payload-free** Realtime Broadcast — `realtime.send(jsonb_build_object('table', TG_TABLE_NAME), 'change', 'team:<team_id>', private => true)` — carrying only the table name, never row data.

- **Why Broadcast, not `postgres_changes`:** `postgres_changes` does not
  RLS-filter DELETE and ships whole-row payloads (would regress SAL-006/011/013).
  These tables are **not** in the `supabase_realtime` publication and keep
  `REPLICA IDENTITY DEFAULT`. See **SAL-035**.
- **Authorization:** an RLS `SELECT` policy on `realtime.messages` (`"team members receive team broadcasts"`) authorizes receipt of `team:<uuid>` topics via the `SECURITY DEFINER` `user_has_team_access()` helper — a client-supplied channel filter is not a boundary.
- **Parity:** the set of triggered tables must equal the module registry's
  aggregated `realtimeTables` (`realtimeWatchedTables()`), enforced by
  `src/__tests__/realtime-parity.test.ts`. Adding a live table means declaring
  it on the owning module **and** adding the trigger in the same PR.
- **Client:** `src/components/realtime-team-signal.tsx` treats the ping as an
  opaque "refetch" trigger for a user-controlled refresh; it never reads the
  payload and never auto-applies.

## Migrations directory

`supabase/migrations/*.sql` — 107 files as of 2026-05-05. Timestamps are monotonic; the latest landed file is the source of truth for next-migration naming. See `docs/reference/migrations.md` for the deploy-ordering playbook (Vercel + db-migrate.yml run in parallel, so additive vs destructive ordering matters).

## Allow-list parity

Every CHECK-constrained enum column has a TS allow-list set in the relevant module's `allow-lists.ts`. The parity test at `src/__tests__/db-parity.test.ts` enforces the two-sided contract — adding a value to the constraint requires updating the TS allow-list in the same PR (and vice versa). Coverage as of 2026-05-05: 22 paired enums.
