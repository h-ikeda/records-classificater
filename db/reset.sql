-- Drop every application table so the schema can be re-applied from scratch.
-- Intended for local development and CI only -- never run this against a
-- production database. `db/schema.sql` itself is kept drop-free so it stays
-- safe to apply once to a fresh Vercel Postgres database.
DROP TABLE IF EXISTS trips               CASCADE;
DROP TABLE IF EXISTS users               CASCADE;
DROP TABLE IF EXISTS vehicle_permissions CASCADE;
DROP TABLE IF EXISTS vehicle_classes     CASCADE;
DROP TABLE IF EXISTS vehicles            CASCADE;
