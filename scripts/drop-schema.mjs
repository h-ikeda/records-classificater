// Drop the preview PostgreSQL schema for a branch. Invoked by the PR-close
// cleanup workflow so that a preview's schema disappears the moment the preview
// is no longer needed.
//
// Usage:
//   node scripts/drop-schema.mjs <git-branch-ref>
//   DROP_SCHEMA=<exact schema name> node scripts/drop-schema.mjs
//
// Refuses to drop the production schema as a safety guard.

import { Client } from 'pg';
import { PRODUCTION_SCHEMA, previewSchemaForRef } from '../src/lib/schema-name.mjs';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  console.error('[drop-schema] DATABASE_URL is not set');
  process.exit(1);
}

const ref = process.argv[2];
const schema = process.env.DROP_SCHEMA || (ref ? previewSchemaForRef(ref) : null);
if (!schema) {
  console.error('[drop-schema] provide a branch ref argument or DROP_SCHEMA env var');
  process.exit(1);
}
if (schema === PRODUCTION_SCHEMA) {
  console.error(`[drop-schema] refusing to drop the production schema "${schema}"`);
  process.exit(1);
}

const client = new Client({ connectionString: baseUrl });
await client.connect();
try {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  console.log(`[drop-schema] dropped schema "${schema}"`);
} finally {
  await client.end();
}
