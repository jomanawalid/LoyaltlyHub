-- seed.sql  (owner: Habiba) - demo data for the end-to-end demonstration.
-- Safe to run more than once. Customers are NOT seeded here: they are registered
-- through the API so that each one also gets a Cognito login.

INSERT INTO businesses (business_id, name)
VALUES ('11111111-1111-4111-8111-111111111111', 'Demo Cafe'),
       ('22222222-2222-4222-8222-222222222222', 'Other Salon')   -- second tenant for isolation tests
ON CONFLICT (business_id) DO NOTHING;

INSERT INTO rewards (reward_id, business_id, name, description, points_cost, stock, created_by)
VALUES
  ('aaaaaaa1-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Free Cappuccino', 'Any size cappuccino', 200, 50, 'seed'),
  ('aaaaaaa1-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Croissant', 'Butter or chocolate croissant', 120, 30, 'seed'),
  ('aaaaaaa1-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Limited Mug', 'Branded ceramic mug', 900, 1, 'seed'),
  ('aaaaaaa1-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'Free Haircut', 'Other business reward (isolation test)', 500, 10, 'seed')
ON CONFLICT (reward_id) DO NOTHING;
