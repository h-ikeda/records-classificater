import { execSync } from 'node:child_process';

// Vercel のビルドコマンド。Neon / Clerk の Vercel ネイティブ統合が前提:
//  - Neon 統合がプレビューごとにブランチを自動作成し、DATABASE_URL /
//    DATABASE_URL_UNPOOLED をその環境（本番・プレビュー）に自動注入する。
//  - Clerk 統合が NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY を自動注入する。
// この統合が面倒を見ない 2 点だけをここで補う:
//  (1) その環境の Neon ブランチへマイグレーションを適用する。
//  (2) ブラウザ用に authenticated ロール（パスワードレス）の接続文字列を導出して埋め込む。

const pooled = process.env.DATABASE_URL;
const unpooled = process.env.DATABASE_URL_UNPOOLED || pooled;

// (1) このデプロイ環境のブランチへマイグレーションを適用（所有者接続を使用）
if (unpooled) {
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
