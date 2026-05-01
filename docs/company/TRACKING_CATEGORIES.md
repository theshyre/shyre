# Tracking Categories

Quick reference for the `category` field in `time-log.csv` and `expenses.csv`.

Same vocabulary as Liv (`/Users/marcus/projects/liv/docs/company/TRACKING_CATEGORIES.md`)
so cross-project totals can be summed without remapping. Add a row to
the table when introducing a new category — keep it canonical.

---

## Time Categories

Used in the `category` column of `time-log.csv`.

| Category | Use for |
|---|---|
| `engineering` | Coding, architecture, technical design, debugging, devops |
| `design` | UI/UX design, wireframes, prototyping, design systems |
| `research` | Market research, competitor analysis, user interviews, reading |
| `product` | Feature planning, specs, requirements, roadmap, prioritization |
| `business` | Business model, pricing, partnerships, legal, formation |
| `admin` | Project management, organizing docs, repo maintenance, tooling |
| `marketing` | Brand, copy, website, positioning, launch planning |

## Expense Categories

Used in the `category` column of `expenses.csv`.

| Category | Use for |
|---|---|
| `domains` | Domain name registrations and renewals |
| `hosting` | Cloud hosting, CDN, serverless compute, database services |
| `software` | SaaS subscriptions, dev tools, licenses, API costs |
| `ai` | LLM API usage, model hosting, AI-specific compute |
| `design-tools` | Figma, fonts, stock assets, icon libraries |
| `legal` | Incorporation, trademarks, legal counsel, agreements |
| `marketing` | Ads, landing pages, content, launch costs |
| `hardware` | Equipment purchased for Shyre development or testing |
| `travel` | Travel related to Shyre (conferences, meetings, user visits) |
| `other` | Anything that doesn't fit above — add a clear description |

---

> The `receipt` field in `expenses.csv` holds an invoice/reference number.
> Keep actual receipts in a folder or cloud drive.

---

## In-app

These same time categories are seeded in Shyre as the **Product Development**
system category set (migration `20260501080000_time_categories_product_development.sql`).
The Shyre internal project attaches that set, so logging time in-app uses the
same vocabulary as the CSV — no remapping at export time.
