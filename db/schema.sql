-- Schema for records-classificater on Vercel Postgres.
--
-- This is the relational translation of the original Firestore model:
--
--   users/{uid}                 -> users
--   vehicles/{vid}              -> vehicles + vehicle_classes + vehicle_permissions
--   vehicles/{vid}/trips/{tid}  -> trips
--
-- User identifiers (`users.id`, `vehicle_permissions.user_id`) are the
-- authentication provider's uid. They are stored as TEXT and are NOT foreign
-- keys to `users`, because a vehicle can be shared with a user before that user
-- has any application state row (mirrors Firestore, where a uid may appear in a
-- vehicle's permissions without a `users/{uid}` document existing).

-- gen_random_uuid() is built into PostgreSQL 13+; keep the extension for safety
-- on older servers. Harmless on Vercel Postgres (Neon, PG 15/16).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Vehicles --------------------------------------------------------------------
CREATE TABLE vehicles (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trip classes available for a vehicle (was the `classes` string array).
-- `position` preserves the display order the UI relies on for its color
-- palette. The (vehicle_id, class) unique key is the target of the trips FK so
-- that a trip can only use a class defined on its own vehicle.
CREATE TABLE vehicle_classes (
  vehicle_id UUID    NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
  class      TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  PRIMARY KEY (vehicle_id, class),
  UNIQUE (vehicle_id, position)
);

-- Per-user read/write permissions (was the `permissions.read` / `.write`
-- arrays). read and write are independent: a user may have write without read,
-- matching the original security rules.
CREATE TABLE vehicle_permissions (
  vehicle_id UUID    NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
  user_id    TEXT    NOT NULL,
  can_read   BOOLEAN NOT NULL DEFAULT FALSE,
  can_write  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (vehicle_id, user_id),
  CHECK (can_read OR can_write)
);

-- Look up "which vehicles can this user see/edit?" without scanning.
CREATE INDEX idx_vehicle_permissions_user ON vehicle_permissions (user_id);

-- Users -----------------------------------------------------------------------
-- Application state for an authenticated user. `current_vehicle_id` is the
-- vehicle currently selected in the UI (was `state.vehicle`).
CREATE TABLE users (
  id                 TEXT        PRIMARY KEY,
  current_vehicle_id UUID        REFERENCES vehicles (id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trips -----------------------------------------------------------------------
-- A single odometer reading for a vehicle. `recorded_at` is the moment the trip
-- was logged (was the Firestore `timestamp`). The composite FK enforces that
-- `class` is one of the vehicle's defined classes, as the security rules did.
CREATE TABLE trips (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID        NOT NULL,
  class       TEXT        NOT NULL,
  odo         NUMERIC     NOT NULL CHECK (odo >= 0),
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (vehicle_id, class)
    REFERENCES vehicle_classes (vehicle_id, class) ON DELETE CASCADE,
  -- The odometer is monotonic per vehicle, so both odo and time are unique.
  UNIQUE (vehicle_id, odo),
  UNIQUE (vehicle_id, recorded_at)
);
