-- Stint: Initial Schema Migration
-- Run this in your Supabase SQL Editor (or via supabase db push)

-- ============================================================
-- 1. TABLES
-- ============================================================

-- User settings (must exist before other tables reference patterns)
CREATE TABLE user_settings (
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  business_name     TEXT,
  business_email    TEXT,
  business_address  TEXT,
  business_phone    TEXT,
  logo_url          TEXT,
  default_rate      NUMERIC(10,2) DEFAULT 0,
  invoice_prefix    TEXT DEFAULT 'INV',
  invoice_next_num  INTEGER DEFAULT 1,
  tax_rate          NUMERIC(5,2) DEFAULT 0,
  github_token      TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Clients
CREATE TABLE clients (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name          TEXT NOT NULL,
  email         TEXT,
  address       TEXT,
  notes         TEXT,
  default_rate  NUMERIC(10,2),
  created_at    TIMESTAMPTZ DEFAULT now(),
  archived      BOOLEAN DEFAULT false
);

-- Projects
CREATE TABLE projects (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id     UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  hourly_rate   NUMERIC(10,2),
  budget_hours  NUMERIC(10,2),
  github_repo   TEXT,
  status        TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Invoices (must exist before time_entries references it)
CREATE TABLE invoices (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_id       UUID REFERENCES clients(id) NOT NULL,
  invoice_number  TEXT NOT NULL,
  issued_date     DATE DEFAULT CURRENT_DATE,
  due_date        DATE,
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void')),
  subtotal        NUMERIC(10,2),
  tax_rate        NUMERIC(5,2) DEFAULT 0,
  tax_amount      NUMERIC(10,2) DEFAULT 0,
  total           NUMERIC(10,2),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Time entries
CREATE TABLE time_entries (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  description   TEXT,
  start_time    TIMESTAMPTZ NOT NULL,
  end_time      TIMESTAMPTZ,
  duration_min  INTEGER GENERATED ALWAYS AS (
                  CASE WHEN end_time IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (end_time - start_time)) / 60
                    ELSE NULL
                  END
                ) STORED,
  billable      BOOLEAN DEFAULT true,
  github_issue  INTEGER,
  invoiced      BOOLEAN DEFAULT false,
  invoice_id    UUID REFERENCES invoices(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Invoice line items
CREATE TABLE invoice_line_items (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id    UUID REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  description   TEXT NOT NULL,
  quantity      NUMERIC(10,2) NOT NULL,
  unit_price    NUMERIC(10,2) NOT NULL,
  amount        NUMERIC(10,2) NOT NULL,
  time_entry_id UUID REFERENCES time_entries(id) ON DELETE SET NULL
);

-- ============================================================
-- 2. INDEXES
-- ============================================================

CREATE INDEX idx_clients_user_id ON clients(user_id);
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_client_id ON projects(client_id);
CREATE INDEX idx_time_entries_user_id ON time_entries(user_id);
CREATE INDEX idx_time_entries_project_id ON time_entries(project_id);
CREATE INDEX idx_time_entries_start_time ON time_entries(start_time);
CREATE INDEX idx_time_entries_invoice_id ON time_entries(invoice_id);
CREATE INDEX idx_invoices_user_id ON invoices(user_id);
CREATE INDEX idx_invoices_client_id ON invoices(client_id);
CREATE INDEX idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);

-- ============================================================
-- 3. ROW-LEVEL SECURITY
-- ============================================================

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;

-- User settings: users manage their own row
CREATE POLICY "Users manage own settings"
  ON user_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Clients: users manage their own clients
CREATE POLICY "Users manage own clients"
  ON clients FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Projects: users manage their own projects
CREATE POLICY "Users manage own projects"
  ON projects FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Invoices: users manage their own invoices
CREATE POLICY "Users manage own invoices"
  ON invoices FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Time entries: users manage their own entries
CREATE POLICY "Users manage own time entries"
  ON time_entries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Invoice line items: users manage line items on their own invoices
CREATE POLICY "Users manage own invoice line items"
  ON invoice_line_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_line_items.invoice_id
      AND invoices.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_line_items.invoice_id
      AND invoices.user_id = auth.uid()
    )
  );

-- ============================================================
-- 4. HELPER: auto-create user_settings on signup
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 5. HELPER: auto-update updated_at on user_settings
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
