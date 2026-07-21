# Financials

The **Financials** tab on a business hub (`Business → Financials`) is a read-only, at-a-glance view of where the money stands — cash on one side, profit-and-loss on the other. It's owner/admin only, and it never sums across currencies.

> **Where to enter numbers.** Financials is a rollup — it doesn't create anything. Log costs on the **Expenses** tab, bill work from **Invoices**, record payments on an invoice. Financials just reads those back.

## Who can see it

Financials is visible only to **owners and admins**, and only for the teams under this business that *you* administer. If your business spans several teams and you're an admin on some but a plain member on others, the figures cover only your admin teams — a member never sees the tab.

## Screen-share safe by default

Every amount is **blurred until you reveal it**. Open the tab on a client call and the numbers stay hidden; click **Reveal amounts** (top-right) to show them, **Hide amounts** to blur again. The choice is remembered on that device. Hidden amounts are genuinely absent — a screen reader can't read a figure you've hidden.

## The period toggle

Pick the window: **Last 12 months** (default), **Year to date**, or **This month**. It drives every period-bounded figure below. Outstanding AR and Unbilled are *snapshots* of where things stand right now, so the period doesn't change them.

## Cash

- **Collected** — gross cash you actually received in the period, from recorded invoice payments. Includes any sales tax you charged. This is the same number the Reports page calls "Collected."
- **Outstanding** — what customers still owe you: unpaid (sent or overdue) invoices, netted against any payments already applied, right now. Below it, an **aging** breakdown buckets that balance by how far past due each invoice is (current, 1–30, 31–60, 61–90, 90+ days) so you know who to chase first.
- **Unbilled** — billable time you've tracked but haven't invoiced yet, in hours. It's the work that's ready to turn into an invoice.

## Profit & Loss

- **Revenue** — income recognized when you were **paid**, *excluding* sales tax. (Sales tax is money you owe the state, not income, so it's kept out — see Tax collected.)
- **Expenses** — all operating expenses **incurred** in the period. This matches the Expenses tab and the expenses CSV, so the numbers tie out.
- **Net** — Revenue minus Expenses, shown as **Profit**, **Loss**, or **Break-even** with a matching color and arrow. It's only computed when revenue and expenses are in one shared currency; with mixed currencies you'll see the per-currency figures instead of a misleading blended total.
- **Tax collected** — the remittable sales tax slice of what you collected. Shown on its own, never folded into Net, so you always know what's yours versus what you owe the state.

## What "basis" means

The caption reads **"Revenue when paid · expenses when incurred · per currency."** That's the honest description: revenue follows the **cash** event (a payment), while expenses follow the date the cost was **incurred**. It's a practical hybrid, not a strict cash- or accrual-basis P&L — worth knowing when you reconcile against formal books.

## Locked periods

If a period has been closed on the **Period locks** tab, a banner notes the lock date. Locked figures are settled — don't expect them to move.

## Related

- [Expenses](expenses.md) — where operating costs are entered.
- [Business identity](business-identity.md) — the legal entity these numbers belong to.
