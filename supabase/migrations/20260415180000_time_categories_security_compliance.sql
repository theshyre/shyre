-- Add a system category set for Security & Compliance.
--
-- Target persona: fractional / vCISO, security consultants, SOC 2 + ISO
-- auditors, compliance analysts. Broad enough to cover both the
-- engineering side (vulnerability management, incident investigation)
-- and the paper side (evidence, policy, risk, vendor review).

DO $$
DECLARE
  sec_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO category_sets (id, organization_id, name, description, is_system) VALUES
    (sec_id, NULL, 'Security & Compliance',
     'Audits, evidence, risk, policy, incident, and vendor work for security / compliance / vCISO engagements',
     true);

  INSERT INTO categories (category_set_id, name, color, sort_order) VALUES
    (sec_id, 'Assessment / Audit',      '#3b82f6', 10),   -- blue-500
    (sec_id, 'Evidence / Documentation','#8b5cf6', 20),   -- violet-500
    (sec_id, 'Risk assessment',         '#f59e0b', 30),   -- amber-500
    (sec_id, 'Policy / Procedure',      '#ec4899', 40),   -- pink-500
    (sec_id, 'Incident investigation',  '#ef4444', 50),   -- red-500
    (sec_id, 'Vulnerability management','#f97316', 60),   -- orange-500
    (sec_id, 'Vendor review',           '#10b981', 70),   -- emerald-500
    (sec_id, 'Training',                '#06b6d4', 80),   -- cyan-500
    (sec_id, 'Client meetings',         '#6366f1', 90),   -- indigo-500
    (sec_id, 'Admin',                   '#9ca3af', 100);  -- gray-400
END $$;
