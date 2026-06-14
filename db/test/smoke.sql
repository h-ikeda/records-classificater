-- Smoke tests for the schema + seed. Run with `psql -v ON_ERROR_STOP=1` after
-- applying db/schema.sql and db/seed.sql; any RAISE EXCEPTION fails the run.

\set ON_ERROR_STOP on

-- 1. Seed loaded the expected number of rows. -------------------------------
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM vehicles) = 2,            'expected 2 vehicles';
  ASSERT (SELECT count(*) FROM vehicle_classes) = 4,     'expected 4 vehicle_classes';
  ASSERT (SELECT count(*) FROM vehicle_permissions) = 4, 'expected 4 vehicle_permissions';
  ASSERT (SELECT count(*) FROM users) = 3,               'expected 3 users';
  ASSERT (SELECT count(*) FROM trips) = 5,               'expected 5 trips';
END $$;

-- 2. Independent read/write permissions are preserved. ----------------------
DO $$
BEGIN
  ASSERT (SELECT can_read AND NOT can_write FROM vehicle_permissions
          WHERE user_id = 'user-reader'
            AND vehicle_id = '11111111-1111-1111-1111-111111111111'),
         'user-reader should be read-only';
  ASSERT (SELECT can_write AND NOT can_read FROM vehicle_permissions
          WHERE user_id = 'user-writer'
            AND vehicle_id = '11111111-1111-1111-1111-111111111111'),
         'user-writer should be write-only';
END $$;

-- 3. A trip cannot use a class that is not defined on its vehicle. -----------
--    (Equivalent to the Firestore rule: trip.class in vehicle.classes.)
DO $$
BEGIN
  INSERT INTO trips (vehicle_id, class, odo, recorded_at)
  VALUES ('11111111-1111-1111-1111-111111111111', 'NotSpecified', 999.0, now());
  RAISE EXCEPTION 'expected a foreign_key_violation for an undefined class';
EXCEPTION
  WHEN foreign_key_violation THEN
    NULL; -- expected
END $$;

-- 4. The odometer is unique per vehicle. ------------------------------------
DO $$
BEGIN
  INSERT INTO trips (vehicle_id, class, odo, recorded_at)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Business', 10.0, now());
  RAISE EXCEPTION 'expected a unique_violation for a duplicate odo';
EXCEPTION
  WHEN unique_violation THEN
    NULL; -- expected
END $$;

-- 5. A permission row must grant at least one capability. -------------------
DO $$
BEGIN
  INSERT INTO vehicle_permissions (vehicle_id, user_id, can_read, can_write)
  VALUES ('22222222-2222-2222-2222-222222222222', 'user-nobody', FALSE, FALSE);
  RAISE EXCEPTION 'expected a check_violation for an empty permission';
EXCEPTION
  WHEN check_violation THEN
    NULL; -- expected
END $$;

-- 6. Deleting a vehicle cascades to its classes, permissions and trips. ------
DO $$
DECLARE
  v UUID := gen_random_uuid();
BEGIN
  INSERT INTO vehicles (id, name) VALUES (v, 'temp');
  INSERT INTO vehicle_classes (vehicle_id, class, position) VALUES (v, 'X', 0);
  INSERT INTO vehicle_permissions (vehicle_id, user_id, can_read) VALUES (v, 'u', TRUE);
  INSERT INTO trips (vehicle_id, class, odo, recorded_at) VALUES (v, 'X', 1.0, now());
  DELETE FROM vehicles WHERE id = v;
  ASSERT (SELECT count(*) FROM vehicle_classes WHERE vehicle_id = v) = 0,     'classes not cascaded';
  ASSERT (SELECT count(*) FROM vehicle_permissions WHERE vehicle_id = v) = 0, 'permissions not cascaded';
  ASSERT (SELECT count(*) FROM trips WHERE vehicle_id = v) = 0,               'trips not cascaded';
END $$;

\echo 'All database smoke tests passed.'
