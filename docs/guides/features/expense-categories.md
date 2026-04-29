# Expense categories — reference

> Quick guide to which category fits which kind of expense, with
> examples. Mirrors the inline help text in the New Expense form
> and the bulk-action category picker; if these drift, the i18n
> bundle (`src/lib/i18n/locales/en/expenses.json` →
> `categoryHelp`) is the source of truth and this doc follows it.

## Why categorize at all?

Expenses get grouped by category on tax reports (Schedule C in
the US, equivalents elsewhere) and on per-period bookkeeping
exports. Grouping is meaningful — your accountant sums each
category, the IRS expects them on specific lines. "Other" is a
last-resort bucket; auditors view a sea of "Other" as a sign the
books haven't been kept.

The CSV importer puts every imported row in **Other** by default
because it can't reliably guess. Re-categorizing post-import is
the work this doc is here to make easier.

## The categories

### Software

Apps, SaaS, hosting, dev tools — anything where you pay to use
software. Doesn't matter if it's a one-time purchase or a
subscription.

**Examples:**

- G Suite / Google Workspace
- Jira / Atlassian Cloud / Confluence
- Adobe Creative Cloud, Photoshop, Illustrator
- Slack, Notion, Figma, Linear, ClickUp
- GitHub, GitLab Cloud
- Linode, AWS, Vercel, Cloudflare hosting
- Cursor, JetBrains, VS Code Pro
- Code-signing certificates

**Edge cases:** A subscription to *Wired* is **subscriptions**, not
software. A subscription to GitHub is **software**. The test:
"am I paying to use software?" → software. "Am I paying for a
non-software membership / publication?" → subscriptions.

---

### Hardware

Physical computing equipment that lasts more than a year.

**Examples:**

- Laptops, desktops, monitors
- Keyboards, mice, trackpads, dock stations
- External drives, USB hubs, cables
- Networking equipment (router, switches, mesh nodes)
- Printers, scanners, label makers
- Phone or tablet bought specifically for work

**Edge cases:** A standing desk converter is **office** (it's
furniture / workspace), not hardware. A monitor IS hardware (it's
computing equipment). Generally: if it has a chip in it that
you're using to compute, it's hardware.

---

### Subscriptions

Non-software recurring memberships. Software subs go under
Software (above).

**Examples:**

- Industry magazines, paid newsletters (Substack, Stratechery)
- Professional associations (IEEE, ABA, local chambers)
- Conference annual passes
- Co-working space memberships
- Premium podcast memberships

**Edge cases:** A Slack workspace is software. A premium subscription
to *Lenny's Newsletter* is subscriptions. A paid podcast feed of
*This American Life* is subscriptions. A co-working day-pass is
subscriptions; a single Airbnb stay for a work trip is travel.

---

### Travel

Business travel costs.

**Examples:**

- Flights, train, rental car, ride share for business trips
- Hotels and lodging
- Mileage on a personal vehicle for business use
- Airport parking, tolls, baggage fees
- International transit (eSIM, currency conversion fees)

**Edge cases:** Meals while traveling go under **meals**, not
travel. Hotel WiFi is part of the hotel cost — travel.

---

### Meals

Business meals. **In the US, 50% deductible** under IRS Schedule
C — your accountant will halve them at tax time. Always keep the
receipt.

**Examples:**

- Client lunches and dinners
- Working meals while traveling for business
- Coffee meetings with prospects
- Conference meals not included in the registration

**Edge cases:** A pack of bagels for the office isn't a "meal"
in the deduction sense — it's office. If you're not sure, ask:
"could a reasonable auditor argue this was a personal lunch?"
If yes, it's meals.

---

### Office

Supplies, furniture, decor, and improvements to your workspace.
The "stuff that lives in your office" bucket.

**Examples:**

- Pens, paper, sticky notes, printer ink
- Desks, chairs, monitor arms, cable management
- Blinds, curtains, lighting fixtures, plants, wall art
- Cleaning supplies, small tools
- Office snacks (coffee, water, communal kitchen items — NOT meals
  with clients)

**Edge cases:** A monitor is **hardware** (it has a chip). A
monitor arm is **office** (it's furniture). Smith and Noble
blinds are office. A printer-cartridge subscription is office
(physical consumables) even though it auto-renews.

---

### Professional services

Outside professionals you hired — not your own labor.

**Examples:**

- Legal fees (LLC formation, contract reviews, IP work)
- Accountant / bookkeeper / CPA
- Financial advisor, investment counsel
- Contracted designer, developer, writer, marketer
- Tax preparation services
- Notary fees for business documents

**Edge cases:** A 1099 contractor's monthly retainer goes here.
LegalZoom or a similar self-service legal site is **software**
(you're using their software, not hiring their lawyers). A bank's
fee for a wire transfer is **fees**, not professional services.

---

### Fees

Transaction, regulatory, and banking fees that aren't bought
services.

**Examples:**

- Bank account fees, monthly maintenance fees
- Wire transfer fees
- Payment processor fees (Stripe, PayPal, Square)
- State annual filing / franchise tax fees
- Credit card late penalties
- Currency conversion fees on credit card

**Edge cases:** Property taxes don't fit here — they're their own
line item on Schedule C; for now, classify as **other** and flag
it for your accountant. Stripe's monthly subscription fee for
Atlas / Tax / Capital is **software**; their per-transaction
processing fees are **fees**.

---

### Other

Catch-all for things that don't fit anywhere else. **Should be
temporary** — re-categorize before tax reports. Auditors view a
sea of "Other" as a sign the books haven't been kept.

**Examples:**

- Default for CSV-imported rows that haven't been categorized
- Edge cases your bookkeeper hasn't classified yet
- Items that genuinely don't fit (rare — most things fit one of
  the eight buckets above)

If you find yourself adding to "Other" frequently, talk to your
accountant — there's likely a sub-category they want broken out
for tax purposes.

## Quick decisions for common Shyre user expenses

| Expense | Category |
|---|---|
| G Suite / Google Workspace subscription | software |
| Jira / Confluence / Atlassian Cloud | software |
| Linode / AWS / DigitalOcean / Vercel hosting | software |
| Adobe Creative Cloud | software |
| Domain renewal (malcom.io, etc.) | software |
| New laptop, monitor, keyboard | hardware |
| Networking equipment | hardware |
| Smith and Noble blinds for office | office |
| Plants, wall art, desk decor | office |
| Pens, paper, printer ink | office |
| Paid newsletter / industry magazine | subscriptions |
| Professional association dues | subscriptions |
| LLC formation fees (legal) | professional_services |
| Accountant retainer | professional_services |
| Stripe / PayPal per-transaction fees | fees |
| State filing fees / franchise tax | fees |
| Wire transfer fees | fees |
| Client lunch | meals |
| Flight to a client site | travel |
| Hotel for a conference | travel |
| Conference registration | subscriptions (or professional_services if it's a workshop with deliverables) |

## Where this guide lives in the UI

- **New Expense form** (`/business/[id]/expenses` → "Add expense"):
  the description + examples for the chosen category render
  inline below the dropdown so you don't have to leave the form
  to look up which one fits.
- **Bulk-action category picker** (when one or more rows are
  selected): each menu item shows the description + a one-line
  example list so you pick by intent, not just by name.
- **Filter bar category chips**: short labels only (the chip is
  one-click), but this doc is linked from the filter bar's help
  icon for the full reference.

## Edge cases your accountant should weigh in on

- Anything you'd categorize as **other** more than once a year
- Mixed-use expenses (home office utilities, phone bill split
  between personal and business)
- Equipment that crosses depreciation thresholds (laptops over
  $2,500 may need to be depreciated over years rather than
  expensed)
- Foreign-currency transactions (Shyre stores native + converted
  amounts; ask your accountant which they want on the report)

These aren't categorization questions Shyre can answer for you —
the right call depends on your tax situation, country, and entity
type. When in doubt, leave the row in "Other" with a note in the
**notes** field describing the expense, and your bookkeeper /
accountant will sort it.
