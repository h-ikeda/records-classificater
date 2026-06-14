// Single source of truth for the PostgreSQL schema name used by a deployment.
//
// Production and every preview deployment share one physical database; they are
// isolated by living in different PostgreSQL schemas. This module derives the
// schema name from the environment so that the runtime (src/lib/prisma.ts), the
// build-time provisioner (scripts/prepare-db.mjs) and the PR-close cleanup
// (scripts/drop-schema.mjs) all agree on exactly the same name.

export const PRODUCTION_SCHEMA = 'public';

/**
 * Turn an arbitrary git branch / ref into a safe Postgres identifier fragment.
 * @param {string} ref
 * @returns {string}
 */
export function sanitizeRef(ref) {
  return ref
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'unknown';
}

/**
 * Build the preview schema name for a given branch/ref.
 * @param {string} ref
 * @returns {string}
 */
export function previewSchemaForRef(ref) {
  return `preview_${sanitizeRef(ref)}`;
}

/**
 * Resolve the schema name for the current environment.
 *
 * Precedence:
 *   1. DATABASE_SCHEMA  – explicit override (used by CI / migration scripts).
 *   2. VERCEL_ENV=production            -> PRODUCTION_SCHEMA.
 *   3. VERCEL_ENV=preview              -> preview_<sanitized branch>.
 *   4. anything else (local dev, tests) -> PRODUCTION_SCHEMA.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveSchemaName(env = process.env) {
  if (env.DATABASE_SCHEMA) return env.DATABASE_SCHEMA;
  if (env.VERCEL_ENV === 'production') return PRODUCTION_SCHEMA;
  if (env.VERCEL_ENV === 'preview') {
    const ref = env.VERCEL_GIT_COMMIT_REF || env.GITHUB_HEAD_REF || '';
    return previewSchemaForRef(ref);
  }
  return PRODUCTION_SCHEMA;
}

/**
 * Append (or replace) the `?schema=` parameter on a Postgres connection string.
 * @param {string} url
 * @param {string} schema
 * @returns {string}
 */
export function withSchema(url, schema) {
  if (!url) return url;
  // URL parsing is the most robust way to set the param without clobbering
  // other query options (sslmode, connection_limit, etc.).
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('schema', schema);
    return parsed.toString();
  } catch {
    // Fall back to naive string handling for non-standard URLs.
    const [base, query = ''] = url.split('?');
    const params = new URLSearchParams(query);
    params.set('schema', schema);
    return `${base}?${params.toString()}`;
  }
}

/**
 * Resolve the full DATABASE_URL for the current environment, with the correct
 * schema applied.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveDatabaseUrl(env = process.env) {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return withSchema(url, resolveSchemaName(env));
}
