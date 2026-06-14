import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// ブラウザから Neon へ直接接続する。接続文字列は JWT ベースの `authenticated` ロール用で、
// 行レベルセキュリティ（Neon RLS）が Clerk の JWT を検証してデータを保護する。
// そのため接続文字列が露出しても、JWT が許可した行以外にはアクセスできない。
const url = process.env.DATABASE_AUTHENTICATED_URL;

// 遅延初期化する。neon('') はモジュール読込時に例外を投げるため、トップレベルで
// 評価すると接続文字列未設定時にアプリ全体が白画面になる。クエリ実行時まで遅らせる。
let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (!cached) {
    if (!url) {
      throw new Error(
        'DATABASE_AUTHENTICATED_URL が設定されていません。Vercel の環境変数（または Neon 接続文字列）を確認してください。',
      );
    }
    cached = drizzle(neon(url), { schema });
  }
  return cached;
}

/**
 * Clerk の JWT を付与した DB クライアントを返す。各クエリで Neon RLS が適用される。
 */
export function authed(token: string) {
  return getDb().$withAuth(token);
}
