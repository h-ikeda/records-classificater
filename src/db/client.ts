import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// ブラウザから Neon へ直接接続する。接続文字列は JWT ベースの `authenticated` ロール用で、
// 行レベルセキュリティ（Neon RLS）が Clerk の JWT を検証してデータを保護する。
// そのため接続文字列が露出しても、JWT が許可した行以外にはアクセスできない。
const url = process.env.DATABASE_AUTHENTICATED_URL;

const sql = neon(url ?? '');
export const db = drizzle(sql, { schema });

/**
 * Clerk の JWT を付与した DB クライアントを返す。各クエリで Neon RLS が適用される。
 */
export function authed(token: string) {
  return db.$withAuth(token);
}
