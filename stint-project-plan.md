# Stint — Project Plan & Spec

A time tracking + invoicing app for a solo consultant, built with **Next.js + Supabase**, deployed free on **Vercel + Supabase Cloud**.

---

## Stack

| Layer        | Technology          | Why                                                    |
|-------------|--------------------|---------------------------------------------------------|
| Framework   | Next.js 14+ (App Router) | Full-stack React, API routes, SSR, free Vercel deploy |
| Database    | Supabase (Postgres) | Free hosted Postgres, auth, real-time, row-level security |
| Auth        | Supabase Auth       | Built-in, email/password or magic link                  |
| Styling     | Tailwind CSS        | Fast to build, easy to customize                        |
| PDF Gen     | `@react-pdf/renderer` | Client-side invoice PDF generation, no server needed   |
| Deployment  | Vercel (hobby)      | Auto-deploy from GitHub, free HTTPS, edge functions     |
| VCS / Issues| GitHub              | Repo + issues as integrated work items                  |

---

## Data Model (Supabase / Postgres)

### `clients`
```sql
CREATE TABLE clients (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) NOT NULL,
  name          TEXT NOT NULL,
  email         TEXT,
  address       TEXT,
  notes         TEXT,
  default_rate  NUMERIC(10,2),            -- default hourly rate for this client
  created_at    TIMESTAMPTZ DEFAULT now(),
  archived      BOOLEAN DEFAULT false
);
```

### `projects`
```sql
CREATE TABLE projects (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id     UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  user_id       UUID REFERENCES auth.users(id) NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  hourly_rate   NUMERIC(10,2),            -- override client rate if set
  budget_hours  NUMERIC(10,2),            -- optional budget cap
  github_repo   TEXT,                     -- e.g. "owner/repo" for issue integration
  status        TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### `time_entries`
```sql
CREATE TABLE time_entries (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) NOT NULL,
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  description   TEXT,
  start_time    TIMESTAMPTZ NOT NULL,
  end_time      TIMESTAMPTZ,              -- NULL while timer is running
  duration_min  INTEGER GENERATED ALWAYS AS (
                  CASE WHEN end_time IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (end_time - start_time)) / 60
                    ELSE NULL
                  END
                ) STORED,
  billable      BOOLEAN DEFAULT true,
  github_issue  INTEGER,                  -- GitHub issue number (optional)
  invoiced      BOOLEAN DEFAULT false,
  invoice_id    UUID REFERENCES invoices(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### `invoices`
```sql
CREATE TABLE invoices (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) NOT NULL,
  client_id     UUID REFERENCES clients(id) NOT NULL,
  invoice_number TEXT NOT NULL,            -- auto-generated, e.g. "INV-2026-001"
  issued_date   DATE DEFAULT CURRENT_DATE,
  due_date      DATE,
  status        TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void')),
  subtotal      NUMERIC(10,2),
  tax_rate      NUMERIC(5,2) DEFAULT 0,
  tax_amount    NUMERIC(10,2) DEFAULT 0,
  total         NUMERIC(10,2),
  notes         TEXT,                     -- appears on invoice as memo
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### `invoice_line_items`
```sql
CREATE TABLE invoice_line_items (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id    UUID REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  description   TEXT NOT NULL,
  quantity      NUMERIC(10,2) NOT NULL,   -- hours
  unit_price    NUMERIC(10,2) NOT NULL,   -- rate
  amount        NUMERIC(10,2) NOT NULL,   -- quantity * unit_price
  time_entry_id UUID REFERENCES time_entries(id)  -- link back to source entry
);
```

### `user_settings`
```sql
CREATE TABLE user_settings (
  user_id           UUID REFERENCES auth.users(id) PRIMARY KEY,
  business_name     TEXT,
  business_email    TEXT,
  business_address  TEXT,
  business_phone    TEXT,
  logo_url          TEXT,                 -- stored in Supabase Storage
  default_rate      NUMERIC(10,2) DEFAULT 0,
  invoice_prefix    TEXT DEFAULT 'INV',
  invoice_next_num  INTEGER DEFAULT 1,
  tax_rate          NUMERIC(5,2) DEFAULT 0,
  github_token      TEXT                  -- encrypted, for GitHub API access
);
```

### Row-Level Security (RLS)

Every table gets the same pattern — users only see their own data:

```sql
-- Enable RLS on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
-- ... repeat for all tables

-- Policy: users can only CRUD their own rows
CREATE POLICY "Users manage own clients"
  ON clients FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- ... repeat for all tables
```

---

## App Structure

```
src/
├── app/
│   ├── layout.tsx              -- root layout, nav sidebar
│   ├── page.tsx                -- dashboard (today's time, recent activity)
│   ├── login/page.tsx          -- auth
│   ├── timer/page.tsx          -- active timer + quick entry
│   ├── time-entries/
│   │   ├── page.tsx            -- list/filter all entries
│   │   └── [id]/page.tsx       -- edit entry
│   ├── clients/
│   │   ├── page.tsx            -- client list
│   │   └── [id]/page.tsx       -- client detail + projects
│   ├── projects/
│   │   ├── page.tsx            -- project list
│   │   └── [id]/page.tsx       -- project detail + time entries
│   ├── invoices/
│   │   ├── page.tsx            -- invoice list
│   │   ├── new/page.tsx        -- create invoice from billable time
│   │   └── [id]/page.tsx       -- view/edit invoice, download PDF
│   ├── reports/page.tsx        -- reporting dashboard
│   └── settings/page.tsx       -- user/business settings
├── components/
│   ├── Timer.tsx               -- start/stop timer widget (persistent in sidebar)
│   ├── TimeEntryForm.tsx       -- manual time entry
│   ├── InvoicePDF.tsx          -- @react-pdf/renderer template
│   ├── GitHubIssuePicker.tsx   -- search/select GitHub issues
│   └── ...
├── lib/
│   ├── supabase/
│   │   ├── client.ts           -- browser client
│   │   ├── server.ts           -- server client (for API routes)
│   │   └── middleware.ts       -- auth middleware
│   ├── github.ts               -- GitHub API helpers
│   └── invoice-utils.ts        -- number generation, calculations
```

---

## Key Features — Build Order

### Phase 1: Foundation (get it working)
1. **Supabase setup** — create project, run SQL migrations, enable RLS
2. **Auth** — login/signup page with Supabase Auth
3. **Settings** — business info, default rate, GitHub token
4. **Clients CRUD** — add/edit/archive clients
5. **Projects CRUD** — add/edit projects under clients, set rates
6. **Time entry** — manual entry form (start time, end time, project, description)
7. **Timer** — start/stop timer widget in sidebar, persists across pages

### Phase 2: Invoicing
8. **Invoice creation** — select client → show unbilled time → generate line items
9. **Invoice PDF** — generate downloadable PDF with business branding
10. **Invoice management** — mark as sent/paid, list with filters

### Phase 3: GitHub Integration
11. **GitHub repo linking** — connect a repo to a project
12. **Issue picker** — when tracking time, optionally link to a GitHub issue
13. **Issue time summary** — see total time logged against an issue

### Phase 4: Polish
14. **Dashboard** — today's hours, weekly summary, active timers
15. **Reports** — hours by client/project, revenue by period, charts
16. **Keyboard shortcuts** — quick start/stop timer, switch projects
17. **Dark mode** — respect system preference

---

## GitHub Integration Detail

Use the GitHub REST API with a personal access token (stored in `user_settings.github_token`):

```typescript
// Fetch issues for a linked repo
const issues = await fetch(
  `https://api.github.com/repos/${repo}/issues?state=open`,
  { headers: { Authorization: `Bearer ${token}` } }
).then(r => r.json());
```

**Features:**
- When starting a timer or adding a time entry, show a searchable dropdown of open issues from the linked repo
- Time entries store the issue number
- On a project page, show time totals grouped by issue
- Optional: add a comment on the GitHub issue when time is logged (nice for visibility)

---

## Deployment Steps

### 1. Supabase
- Create free project at supabase.com
- Run the SQL schema above in the SQL Editor
- Note your project URL and anon key

### 2. GitHub Repo
- Create a new repo
- `npx create-next-app@latest stint --typescript --tailwind --app`
- Build the app

### 3. Vercel
- Connect GitHub repo to Vercel
- Add environment variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Deploy — every push to `main` auto-deploys

### Total monthly cost: **$0**

---

## Claude Code Prompt

Use this as your starting prompt in Claude Code:

```
I'm building a time tracking and invoicing web app called Stint. The full
spec is in stint-project-plan.md — please read it first.

Start with Phase 1. Set up the Next.js project with:
- App Router
- Tailwind CSS
- Supabase client (@supabase/ssr)
- TypeScript

Create the Supabase migration SQL file with all the tables and RLS policies
from the spec. Then build out auth (login page + middleware) and the
clients CRUD pages. Use a clean, minimal sidebar layout.

I'll provide my Supabase URL and anon key as env vars.
```

---

## Notes

- **Why not tRPC / Prisma?** Supabase's client library already gives you typed
  queries and RLS handles authorization. Adding tRPC + Prisma adds complexity
  for a solo app with no benefit.
- **Why client-side PDF?** Avoids needing server-side rendering or a headless
  browser. `@react-pdf/renderer` runs in the browser and produces clean PDFs.
- **Scaling later:** If you add team members, Supabase Auth + RLS already
  supports it. You'd add a `team_id` column and adjust policies.
- **Backup:** Supabase free tier includes daily backups for 7 days. For extra
  safety, you could add a GitHub Action that exports your data weekly.
