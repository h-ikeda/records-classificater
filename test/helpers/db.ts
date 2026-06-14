import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../src/db/schema';

// Neon 本番では `auth.user_id()` と `authenticated` ロールは Neon が提供するが、
// pglite には無いのでテスト用に同等のものを用意する。
// auth.user_id() はセッション GUC `app.user_id` を読み、Clerk の sub クレームを模す。
const AUTH_BOOTSTRAP = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.user_id', true), '')
  $$;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE anonymous NOLOGIN;
  GRANT USAGE ON SCHEMA auth TO authenticated, anonymous;
  GRANT EXECUTE ON FUNCTION auth.user_id() TO authenticated, anonymous;
`;

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * pglite 上にスキーマ（生成済みマイグレーション）と Neon RLS 相当の前提を構築する。
 */
export async function createTestDb(): Promise<{ client: PGlite; db: TestDb }> {
  const client = new PGlite();
  await client.exec(AUTH_BOOTSTRAP);
  const dir = join(__dirname, '../../drizzle');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = readFileSync(join(dir, file), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
  const db = drizzle(client, { schema });
  return { client, db };
}

/**
 * `authenticated` ロール + 指定ユーザーの JWT クレームで処理を実行し、RLS を適用させる。
 * 終了後は所有者ロールへ戻す。
 */
export async function asUser<T>(client: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await client.exec('SET ROLE authenticated;');
  await client.query("SELECT set_config('app.user_id', $1, false)", [userId]);
  try {
    return await fn();
  } finally {
    await client.exec('RESET ROLE;');
    await client.query("SELECT set_config('app.user_id', $1, false)", ['']);
  }
}
