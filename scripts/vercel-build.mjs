import { execSync } from 'node:child_process';
import { neon } from '@neondatabase/serverless';

// Vercel のビルドコマンド。Neon / Clerk の Vercel ネイティブ統合が前提:
//  - Neon 統合がプレビューごとにブランチを自動作成し、DATABASE_URL /
//    DATABASE_URL_UNPOOLED をその環境（本番・プレビュー）に自動注入する。
//  - Clerk 統合が NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY を自動注入する。
// ブラウザは Neon Data API(REST) を NEXT_PUBLIC_NEON_DATA_API_URL 経由で叩く
// （Clerk JWT を Bearer 送信、RLS で保護）。ここではその環境のブランチへ
// マイグレーションを適用するだけでよい。

const pooled = process.env.DATABASE_URL;
const unpooled = process.env.DATABASE_URL_UNPOOLED || pooled;

/**
 * RLS の前提（authenticated ロールと auth.user_id()）が用意されているか確認する。
 * 無ければマイグレーション（GRANT / ポリシー作成）が失敗するため、分かりやすく停止する。
 */
async function assertRlsPrerequisites(connectionString) {
  const sql = neon(connectionString);
  const [role] = await sql`select 1 as ok from pg_roles where rolname = 'authenticated'`;
  const [fn] = await sql`
    select 1 as ok from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'user_id'`;
  if (!role || !fn) {
    console.error(
      [
        '',
        '✗ Neon の RLS 前提（authenticated ロール / auth.user_id()）が見つかりません。',
        '  Neon コンソールで Data API / RLS を有効化し、Clerk を認証プロバイダとして登録してください。',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
}

// このデプロイ環境のブランチへマイグレーションを適用（所有者接続を使用）
if (unpooled) {
  await assertRlsPrerequisites(pooled);
  execSync('npm run db:migrate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: unpooled },
  });
} else {
  console.warn('DATABASE_URL is not set; skipping migrations.');
}

// Parcel ビルド。NEXT_PUBLIC_* は process.env からそのまま埋め込まれる。
execSync('parcel build', { stdio: 'inherit' });
