-- Deterministic seed data for tests and local development.
--
-- The fixed UUIDs and user ids below are stable so tests can reference them
-- directly. The shape mirrors test/firestore-rules.spec.ts: one fully shared
-- vehicle (owner + read-only + write-only users) and one private vehicle.
--
-- User ids (authentication uids):
--   user-owner   -- read + write on both vehicles
--   user-reader  -- read only on the カローラ
--   user-writer  -- write only on the カローラ
--
-- Insert order respects foreign keys:
--   vehicles -> vehicle_classes -> vehicle_permissions -> users -> trips

INSERT INTO vehicles (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'カローラ'),
  ('22222222-2222-2222-2222-222222222222', 'ランサー');

INSERT INTO vehicle_classes (vehicle_id, class, position) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Business', 0),
  ('11111111-1111-1111-1111-111111111111', 'Private',  1),
  ('22222222-2222-2222-2222-222222222222', 'Commute',  0),
  ('22222222-2222-2222-2222-222222222222', 'Leisure',  1);

INSERT INTO vehicle_permissions (vehicle_id, user_id, can_read, can_write) VALUES
  ('11111111-1111-1111-1111-111111111111', 'user-owner',  TRUE,  TRUE),
  ('11111111-1111-1111-1111-111111111111', 'user-reader', TRUE,  FALSE),
  ('11111111-1111-1111-1111-111111111111', 'user-writer', FALSE, TRUE),
  ('22222222-2222-2222-2222-222222222222', 'user-owner',  TRUE,  TRUE);

INSERT INTO users (id, current_vehicle_id) VALUES
  ('user-owner',  '11111111-1111-1111-1111-111111111111'),
  ('user-reader', '11111111-1111-1111-1111-111111111111'),
  ('user-writer', '11111111-1111-1111-1111-111111111111');

-- Trips with a strictly increasing odometer over time, per vehicle.
INSERT INTO trips (id, vehicle_id, class, odo, recorded_at) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Business', 10.0,  '2026-01-05T08:00:00+09:00'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Private',  42.5,  '2026-01-05T18:30:00+09:00'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Business', 123.4, '2026-01-06T09:15:00+09:00'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Commute',  5.0,   '2026-02-01T07:45:00+09:00'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Leisure',  88.8,  '2026-02-03T12:00:00+09:00');
