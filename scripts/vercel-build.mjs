import { execSync } from 'node:child_process';
import { neon } from '@neondatabase/serverless';

// Vercel のビルドコマンド。Neon / Clerk の Vercel ネイティブ統合が前提:
//  - Neon 統合がプレビューごとにブランチを自動作成し、DATABASE_URL /
//    DATABASE_URL_UNPOOLED をその環境（本番・プレビュー）に自動注入する。
//  - Clerk 統合が NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY を自動注入する。
// この統合が面倒を見ない 2 点だけをここで補う:
//  (1) その環境の Neon ブランチへマイグレーションを適用する。
//  (2) ブラウザ用に authenticated ロール（パスワードレス）の接続文字列を導出して埋め込む。

const pooled = process.env.DATABASE_URL;
const unpooled = process.env.DATABASE_URL_UNPOOLED || pooled;

/**
 * Neon Authorize (Neon RLS) が有効か確認する。
 * 有効化されていないと `authenticated` ロールと `auth.user_id()` が存在せず、
 * マイグレーション（GRANT / RLS ポリシー）が失敗する。
 */
async function assertNeonAuthorizeEnabled(connectionString) {
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
        '✗ Neon Authorize (Neon RLS) がこのデータベースで有効になっていません。',
        '  `authenticated` ロール / `auth.user_id()` が見つかりません。',
        '  これらは Neon が管理するため、マイグレーションでは作成しません。',
        '',
        '  対応手順:',
        '   1. Neon コンソール → 対象プロジェクト → Settings → Authorize (RLS) を有効化',
        '   2. 認証プロバイダに Clerk を追加（Clerk の JWKS URL を登録）',
        '   3. 既存のプレビューブランチは Authorize 有効化前に作られているため、',
        '      Neon で当該 preview ブランチを削除して再デプロイする',
        '      （Authorize 済みの親ブランチから新しいブランチが作成される）',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
}

// (1) このデプロイ環境のブランチへマイグレーションを適用（所有者接続を使用）
if (unpooled) {
  await assertNeonAuthorizeEnabled(pooled);
  execSync('npm run db:migrate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: unpooled },
  });
} else {
  console.warn('DATABASE_URL is not set; skipping migrations.');
}

// (2) DATABASE_URL から authenticated ロールの接続文字列を導出する。
//     プレビューごとにホストが変わるため、明示設定が無ければ毎ビルドで導出する。
//     （所有者の DATABASE_URL はバンドルに含めない。コードが参照するのはこの導出値のみ）
let authenticatedUrl = process.env.DATABASE_AUTHENTICATED_URL;
if (!authenticatedUrl && pooled) {
  const u = new URL(pooled);
  u.username = 'authenticated';
  u.password = '';
  authenticatedUrl = u.toString();
}

// (3) Parcel ビルド
execSync('parcel build', {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_AUTHENTICATED_URL: authenticatedUrl ?? '' },
});
