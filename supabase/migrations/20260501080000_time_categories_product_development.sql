-- Add system category set: Product Development.
--
-- Cross-functional discipline vocabulary for product / R&D work where
-- the contributor wears many hats — engineering one hour, design the
-- next, then a customer call. Aimed at solo founders and small product
-- teams tracking equity contributions (Slicing Pie) where the question
-- is "what role were you in?" rather than "what kind of dev work?"
--
-- Sits alongside Software / Engineering (which serves engineering
-- teams reporting to clients on Feature / Bug fix / Refactor / Review
-- granularity). Different vocabulary for a different audience.
--
-- Same shape as the other system sets: is_system=true with both
-- team_id and project_id NULL so any team can attach the set to a
-- project via projects.category_set_id, or clone it.

DO $$
DECLARE
  product_dev_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO category_sets (id, team_id, project_id, name, description, is_system) VALUES
    (product_dev_id, NULL, NULL, 'Product Development',
     'Engineering, design, research, product, business, marketing, admin — for founders and product teams tracking cross-functional work',
     true);

  INSERT INTO categories (category_set_id, name, color, sort_order) VALUES
    (product_dev_id, 'Engineering', '#3b82f6', 10),  -- blue-500
    (product_dev_id, 'Design',      '#8b5cf6', 20),  -- violet-500
    (product_dev_id, 'Research',    '#06b6d4', 30),  -- cyan-500
    (product_dev_id, 'Product',     '#10b981', 40),  -- emerald-500
    (product_dev_id, 'Business',    '#f59e0b', 50),  -- amber-500
    (product_dev_id, 'Marketing',   '#ec4899', 60),  -- pink-500
    (product_dev_id, 'Admin',       '#9ca3af', 70);  -- gray-400
END $$;
