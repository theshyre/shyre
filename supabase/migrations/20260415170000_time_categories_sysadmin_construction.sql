-- Add two new system category sets: System Administration + Construction.
--
-- System Administration: for the sysadmin / IT / devops / SRE persona.
-- Construction: general contractor tracking their own time — estimating,
-- supervision, client meetings, paperwork. (Not per-trade labor tracking.)
--
-- Both seeded as is_system=true with organization_id=NULL so every user
-- can clone them. Same shape as the 5 sets seeded in 014_time_categories.

DO $$
DECLARE
  sysadmin_id     UUID := gen_random_uuid();
  construction_id UUID := gen_random_uuid();
BEGIN
  -- Column was renamed from organization_id → team_id in 20260415120000.
  -- These migrations were authored against the old schema; the original
  -- push errored on prod (SQLSTATE 42703) and the whole DO block rolled
  -- back, so editing in place is safe — Supabase never marked it applied.
  INSERT INTO category_sets (id, team_id, name, description, is_system) VALUES
    (sysadmin_id,     NULL, 'System Administration', 'Incident response, maintenance, provisioning, support for IT / devops / SRE work', true),
    (construction_id, NULL, 'Construction', 'Estimating, supervision, permits, procurement, client meetings for general contractors', true);

  -- System Administration
  INSERT INTO categories (category_set_id, name, color, sort_order) VALUES
    (sysadmin_id, 'Incident response', '#ef4444', 10),  -- red-500
    (sysadmin_id, 'Maintenance',       '#f59e0b', 20),  -- amber-500
    (sysadmin_id, 'Monitoring',        '#06b6d4', 30),  -- cyan-500
    (sysadmin_id, 'Provisioning',      '#3b82f6', 40),  -- blue-500
    (sysadmin_id, 'Patching',          '#8b5cf6', 50),  -- violet-500
    (sysadmin_id, 'User support',      '#10b981', 60),  -- emerald-500
    (sysadmin_id, 'Documentation',     '#ec4899', 70),  -- pink-500
    (sysadmin_id, 'Planning',          '#6366f1', 80),  -- indigo-500
    (sysadmin_id, 'Meetings',          '#64748b', 90),  -- slate-500
    (sysadmin_id, 'Admin',             '#9ca3af', 100); -- gray-400

  -- Construction
  INSERT INTO categories (category_set_id, name, color, sort_order) VALUES
    (construction_id, 'Estimating / Bidding',      '#3b82f6', 10),  -- blue-500
    (construction_id, 'Site supervision',          '#f97316', 20),  -- orange-500
    (construction_id, 'Sub coordination',          '#8b5cf6', 30),  -- violet-500
    (construction_id, 'Permits / Inspections',     '#f59e0b', 40),  -- amber-500
    (construction_id, 'Procurement / Materials',   '#10b981', 50),  -- emerald-500
    (construction_id, 'Client meetings',           '#6366f1', 60),  -- indigo-500
    (construction_id, 'Walk-through / Punch list', '#ef4444', 70),  -- red-500
    (construction_id, 'Travel',                    '#64748b', 80),  -- slate-500
    (construction_id, 'Admin',                     '#9ca3af', 90);  -- gray-400
END $$;
