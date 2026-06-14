# Database (Vercel Postgres)

Relational schema for records-classificater, used after migrating off
Firebase/Firestore to [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres).

## Files

| File               | Purpose                                                        |
| ------------------ | ------------------------------------------------------------- |
| `schema.sql`       | Table definitions. Drop-free, safe to apply once to a new DB. |
| `seed.sql`         | Deterministic seed data for tests and local development.      |
| `reset.sql`        | Drops every table so the schema can be re-applied (dev/CI).   |
| `test/smoke.sql`   | Assertions over the schema constraints and seed data.         |

## Data model

The Firestore collections map to tables as follows:

| Firestore                    | Postgres                                              |
| ---------------------------- | ----------------------------------------------------- |
| `users/{uid}`                | `users` (`current_vehicle_id` was `state.vehicle`)    |
| `vehicles/{vid}`             | `vehicles` + `vehicle_classes` + `vehicle_permissions`|
| `vehicles/{vid}/trips/{tid}` | `trips` (`recorded_at` was `timestamp`)               |

- User ids are the auth provider's uid, stored as `TEXT`. They are not foreign
  keys to `users`, because a vehicle can be shared with a user who has no
  application state row yet (as in Firestore).
- `permissions.read` / `permissions.write` arrays become per-user boolean
  columns on `vehicle_permissions`; read and write remain independent.
- The `classes` array becomes `vehicle_classes` (ordered by `position`). The
  composite foreign key from `trips` enforces that a trip's `class` is one of
  its vehicle's classes — the same invariant the Firestore rules enforced.

## Usage

These scripts call `psql` and expect a `POSTGRES_URL` connection string, which is
exactly what Vercel Postgres provisions. Pull it locally with:

```sh
vercel env pull .env.local   # provides POSTGRES_URL
export $(grep POSTGRES_URL .env.local)
```

Then:

```sh
npm run db:schema   # create tables
npm run db:seed     # load seed data
npm run db:reset    # drop, recreate, and reseed (dev/CI only)
npm run db:test     # schema + seed + smoke tests on a fresh database
```

> `db:reset` and `db:test` are destructive — never point `POSTGRES_URL` at a
> production database when running them.

## CI

`.github/workflows/database.yml` runs on changes under `db/`. It boots a
`postgres:16` service, applies `schema.sql`, loads `seed.sql`, runs the smoke
tests, and verifies that `reset.sql` makes the whole thing repeatable.
