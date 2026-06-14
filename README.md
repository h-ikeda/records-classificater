# Records Classificater

走行記録を業務用 / 私用などに分類して集計する Web アプリ。

インフラを **Firebase から Vercel + Neon (Postgres) + Clerk** へ移行しました。

## アーキテクチャ

| 役割 | 旧 (Firebase) | 新 |
| --- | --- | --- |
| ホスティング | Firebase Hosting | **Vercel**（静的 SPA / Parcel ビルド） |
| 認証 | Firebase Auth | **Clerk** (`@clerk/clerk-react`) |
| データベース | Firestore | **Neon (Postgres)**、`@neondatabase/serverless` + Drizzle でブラウザから直接接続 |
| データ保護 | Firestore セキュリティルール | **Neon RLS (Neon Authorize)** — Clerk の JWT を `auth.user_id()` で検証し行レベルで保護 |

ブラウザは Neon の `authenticated`（JWT ベース）ロールで接続し、Clerk のトークンを各クエリに付与します。
行の可否はすべて Postgres の RLS ポリシー（`src/db/schema.ts` / `drizzle/`）が判定するため、接続文字列が露出してもデータは保護されます。

## ディレクトリ

```
src/db/schema.ts        Drizzle スキーマ + RLS ポリシー
src/db/client.ts        ブラウザ用 Neon クライアント（Clerk JWT を付与）
src/db/queries.ts       データアクセス層（旧 Firestore 操作の置き換え）
src/db/seed-data.ts     プレビュー / 開発用サンプルデータ
src/migration/firestore.ts  Firestore → Neon 移行ロジック（ドライバ非依存）
drizzle/                生成済みマイグレーション（0000 ヘルパー関数 → 0001 テーブル+RLS → 0002 GRANT）
scripts/migrate-firestore.ts  本番 Firestore → Neon 移行スクリプト
scripts/seed.ts         シード投入スクリプト
test/                   移行テスト（エミュレータ→pglite）と RLS テスト（pglite）
```

## セットアップ

1. `.env.example` を `.env` にコピーして値を設定する。
2. Neon プロジェクトで **Neon Authorize（RLS）** を有効化し、Clerk を JWT プロバイダ（JWKS）として登録する。
   これにより `authenticated` ロールと `auth.user_id()` が用意される。
3. マイグレーションを適用: `npm run db:migrate`
4. （任意）サンプルデータ投入: `npm run db:seed`

## 開発

```bash
npm start          # Parcel 開発サーバー
npm run build      # 本番ビルド（dist/）
npm run typecheck  # 型チェック
npm test           # テスト（Firestore エミュレータ + pglite）
```

### データベース

```bash
npm run db:generate   # スキーマ変更からマイグレーション生成
npm run db:migrate    # マイグレーション適用
npm run db:push       # スキーマを直接反映（開発用）
```

## テスト

- **移行テスト** (`test/migration.spec.ts`): Firestore エミュレータにデータを投入し、`pglite`（インプロセス Postgres）へ移行できることを検証する。
- **RLS テスト** (`test/rls.spec.ts`): 生成済みマイグレーションを `pglite` に適用し、旧 Firestore ルールと同等の保護が効くことを検証する。

`npm test` は Firestore エミュレータ（Java が必要）を起動して Jest を実行する。

## Firestore からのデータ移行

本番 Firestore のデータを Neon へ移すには:

```bash
# サービスアカウントと Neon の所有者接続文字列を環境変数に設定して実行
DATABASE_URL=<owner-url> FIREBASE_SERVICE_ACCOUNT='<json>' npm run migrate:firestore
```

移行内容:
- `vehicles/{vid}` → `vehicles` + `vehicle_members`（read/write 配列を権限行へ展開）
- `vehicles/{vid}/trips/{tid}` → `trips`
- `users/{uid}` → `user_states`
- 旧形式 `trips/{uid}`（車両導入前）→ 未移行ユーザーのみ新しい車両へ変換

移行ロジックはエミュレータでテスト済み（`npm test`）。

## デプロイ（Vercel）

Neon・Clerk は **Vercel のネイティブ統合**でリンクする前提。環境変数とプレビュー DB は統合が自動で用意する:

- **Neon 統合**: プレビュー（PR）ごとに Neon ブランチを自動作成し、`DATABASE_URL` /
  `DATABASE_URL_UNPOOLED` を各環境（本番・プレビュー）へ自動注入。git ブランチの
  マージ／削除時に Neon ブランチも自動削除。→ **専用の GitHub Actions は不要**。
- **Clerk 統合**: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` を自動注入。

統合が面倒を見ない 2 点だけをビルド (`scripts/vercel-build.mjs`) で補う:

1. その環境の Neon ブランチへ **マイグレーションを適用**（注入された `DATABASE_URL` を使用）。
2. ブラウザ用に **`authenticated` ロール（パスワードレス）の接続文字列を `DATABASE_URL` から導出**して
   バンドルへ埋め込む（所有者の `DATABASE_URL` はバンドルに含めない）。
   ホストがプレビューごとに変わるため、毎ビルドで導出する。明示的に
   `DATABASE_AUTHENTICATED_URL` を設定した場合はそちらを優先。

`vercel.json` がビルドコマンド (`npm run vercel-build`)・出力 (`dist`)・SPA リライトを定義する。

前提: Neon プロジェクトで **Neon Authorize（RLS）を有効化**し、Clerk を JWT プロバイダとして
登録しておくこと（`authenticated` ロールと `auth.user_id()` がプロジェクト全体に用意される）。
プレビューブランチは親（本番）からのコピーなのでシードは不要。
