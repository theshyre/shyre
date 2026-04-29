# Going live: Harvest → Shyre cutover checklist

Walk-through for moving from Harvest (or whatever you've been using) to Shyre as your daily time-tracking + invoicing system. Each item below is a "you can confirm this in under 30 seconds" check; if any of them surfaces a gap, fix it before you import historical data.

The order matters: most of these set baseline state that the import + first invoice will inherit.

## 1 · Identity

- [ ] **Sidebar → Business → pick your business → Identity tab.**
  - Legal name filled in (the name that appears on invoices and tax forms — typically `Marcus Malcom LLC`, not `marcus`)
  - Entity type set (Sole prop / LLC / S-Corp / etc.)
  - Tax ID (EIN) filled in
  - Date of incorporation
  - Fiscal year start (`01-01` for calendar year — leave default unless you actually use a non-calendar fiscal year)
  - Hit **Save business identity**. Confirm the page header at the top shows the new entity-type pill (e.g. "S-Corp"). The change appears in the audit trail at `/business/[id]/identity/history`.

- [ ] **State registrations.** If your LLC is registered in Delaware/Wyoming/your home state plus foreign-qualified anywhere, add each one under the State registrations section. The formation state is `is_formation = true` and there can only be one. Foreign qualifications are everything else.

## 2 · People

- [ ] **Sidebar → Business → People tab → Add person.**
  - Add yourself as `Owner` first. If you'll later 1099 or W-2 anyone, add them too — but you can do this any time; it's not a blocker for cutover.
  - Linking yourself to the Shyre user account (the dropdown at the top of the form) is what makes "log time as Marcus" attribute correctly later.

## 3 · Invoice numbering — biggest gotcha

- [ ] **Sidebar → Profile → Business information → Invoice prefix + Next invoice number.**

  This is the one that bites. If Harvest already issued `INV-2024-001` through `INV-2026-150`, set `Next invoice number` to **151** (or whatever's higher than your last Harvest invoice). Otherwise the next invoice you generate in Shyre collides with a Harvest one — same number, different system, your bookkeeper hates you.

  Default tax rate while you're here: set it once per business so new invoices pick it up.

## 4 · Customers + projects (let the import create them)

- [ ] You don't need to pre-create customers or projects. The Harvest importer creates them on the fly with `imported_from = "harvest"` so it's idempotent (re-runs dedupe via `import_source_id`).
- [ ] **Rates after the import — audit, don't pre-create.** Reports read rates *live* at report time (`project.hourly_rate ?? customer.default_rate ?? defaultRate`), not at time-entry creation, so the deadline is "before your next report run," not "before the import." Right after the import:
  - Projects: Harvest's `hourly_rate` is preserved on the project row, so most projects come in already correct. Open `/projects` and look for any with `—` in the rate column — those are the ones Harvest didn't have a rate on.
  - Customers: Harvest has no customer-level rate, so every imported customer arrives with `default_rate = null`. If you want a customer-level fallback for projects that don't have their own rate, set it via Sidebar → Customers → click each.
  - Per-entry rates: when Harvest had a `billable_rate` that differed from the project rate, the importer stamps a note in the entry's description (the `time_entries` table has no rate column). Revenue rollups still use the project/customer/default chain, not the per-entry note — so if you relied on per-entry overrides, plan to either normalize them onto the project rate or accept the rollup uses the canonical rate.

## 5 · Integrations (optional but cheap)

- [ ] **Sidebar → Profile → Integrations → Jira.**
  Already done per our earlier conversation. The "Test connection" button confirms it, and the expires-on date drives the warning pill so you don't get a silent 401 in 11 months.

- [ ] **GitHub PAT.** Same surface, same pattern. Mint a fine-grained PAT at `github.com/settings/tokens?type=beta` with `Issues:read` on the repos you'll link to. Without this, GitHub references in time-entry descriptions render as a chip with just the key — no title, no link.

- [ ] **Per-project defaults** if you log time mostly against one repo / one Jira project. Sidebar → Projects → click each → set `GitHub repo` and/or `Jira project key`. Then bare `#123` in your descriptions auto-resolves.

## 6 · Personal preferences

- [ ] **Sidebar → Profile → Preferences.**
  - **Timezone**: your IANA zone (e.g. `America/Los_Angeles`). Determines day boundaries; mismatch here makes "this week" reports drift by ±1 day.
  - **Week start**: Monday or Sunday — match what you use mentally.
  - **Time format**: 12h or 24h.
  - **Locale**: en or es.
  - **Text size**: Compact / Regular / Large.

- [ ] **Display name + avatar** under the Profile section. Authorship shows up on every time-entry row, every expense row, every invoice line item — make it look like you.

## 7 · Security

- [ ] **Sidebar → Profile → Security → Set up MFA (TOTP).**
  Real client data is about to land. Enable 2FA before, not after.

## 8 · Take a backup

- [ ] **Supabase dashboard → Database → Backups → Create new backup.**
  Cheap insurance. If anything in the import goes sideways you can roll back to a clean state in one click instead of `cleanup:test-data` + re-running setup.

## 9 · The import itself — year by year, newest first

> **Don't do "all years" in one shot.** Per-batch verification + per-batch undo is worth the extra clicks.

For each year, in this order:

1. **Sidebar → Import → Harvest → set date range to the year, hit Preview.**
2. **In the preview, verify the user mapping** if your Harvest account has multiple users. The dropdown maps each Harvest user → Shyre user / "importer" / "skip". A wrong map silently attributes co-workers' hours to you (this was the SAL-009 fix and the security-side defense; the UI-side defense is *your eyes on the preview*).
3. **Confirm + run.** Wait for the import_run row to land in `/import` history.
4. **Verify totals.** Open Harvest's report for the same year, compare:
   - Total hours (Reports → Time → Year)
   - Billable hours
   - Revenue (if rates were set in Harvest)
   These should match within rounding cents. If a number is off by 10%+, undo the import (one click in `/import`'s history), fix the rate or mapping, re-run.
5. **Lock the period.** Sidebar → Business → Period locks → set `period_end = 2025-12-31` (or whatever year you just imported). After the lock, any retro edit to a 2025 time entry / expense / invoice raises a check-violation so the books don't drift.
6. Check `/admin/errors` for any silently-collected import failures. The route is sysadmin-only; if you're the sysadmin (you are, on a solo account), the link's in the sidebar under Admin.

Recommended order:
- **Current YTD first** (memory is freshest; verify against Harvest's YTD report) → if that matches, your mapping is right. Don't lock current year yet — you'll keep adding to it.
- **Last full year**, lock it.
- **Year before**, lock it.
- Etc., back as far as you have data worth keeping.

## 10 · The cutover moment

- [ ] **Pick a date.** Same day, you stop logging in Harvest and start in Shyre. Don't dual-track — every hour you log twice is an hour you'll have to reconcile or delete from one side.
- [ ] **Generate one test invoice** for the just-imported month, against the just-imported customer. Open Sidebar → Invoices → New invoice → pick that customer. Confirm the line items pull, the totals match, the PDF downloads cleanly, the EIN + legal name show up correctly in the header. You don't have to send it; just verify it generates.
- [ ] **Check `/admin/errors` one more time.** If anything's in there from the import or the test invoice, eyeball it now — silent errors get harder to debug as the log fills.

## 11 · After cutover (first week)

- [ ] **Daily**: log time in Shyre. The keyboard shortcut for "new entry" is `N` from the Time page; `Space` toggles the timer.
- [ ] **End of week**: open Reports. Confirm the per-customer / per-project / per-member tables look right. If something's missing, the import is the suspect — revisit the year.
- [ ] **End of month**: generate next month's invoices, lock the closed month under Period locks.
- [ ] **First mid-month token expiry warning**: when the pill on Profile → Integrations turns yellow, that's your cue to renew the GitHub or Jira token. Don't wait for the red pill.

## 12 · Things you probably won't need but should know exist

- **`/time-entries/trash`** — soft-deleted time entries; restore with one click within 30 days.
- **`/business/[id]/identity/history`** — every change to legal name / EIN / fiscal year / state registrations, with actor + timestamp.
- **`/business/[id]/people/history`** — same for People.
- **`/admin/errors`** — system-wide error log; first stop when something feels off.
- **CSV exports** — `/api/invoices/csv`, `/api/business/[id]/identity-history/csv`, `/api/business/[id]/people-history/csv`. Useful for handing the bookkeeper a snapshot.
- **Period locks unlock** — if you ever absolutely have to amend a closed period, the lock can be removed (typed-confirm "unlock"). Both lock and unlock events are recorded in `team_period_locks_history` so the audit trail survives.

---

If anything on this list isn't where you expect it, ping me — that's a doc bug.
