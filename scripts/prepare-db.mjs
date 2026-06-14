// Provision the PostgreSQL schema for the current deployment and sync the
// Prisma schema into it. Runs as part of `npm run build`, so:
//   - production builds prepare the `public` schema;
//   - preview builds prepare an isolated `preview_<branch>` schema in the SAME
//     database (dropped later by the PR-close cleanup workflow).
//
// If DATABASE_URL is not configured (e.g. a CI job that only type-checks the
// build), provisioning is skipped with a warning instead of failing.

import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { resolveSchemaName, withSchema } from '../src/lib/schema-name.mjs';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  console.warn('[prepare-db] DATABASE_URL is not set; skipping schema provisioning.');
  process.exit(0);
}

const schema = resolveSchemaName();
const url = withSchema(baseUrl, schema);

async function ensureSchema() {
  // Connect to the default schema to create the target schema if needed.
  const client = new Client({ connectionString: baseUrl });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    console.log(`[prepare-db] ensured schema "${schema}"`);
  } finally {
    await client.end();
  }
}

await ensureSchema();

// Sync the Prisma models into the target schema. `db push` is idempotent and
// keeps preview schemas in lock-step with the committed schema without needing
// migration files.
console.log(`[prepare-db] syncing Prisma schema into "${schema}"`);
execSync('npx prisma db push --skip-generate', {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});
