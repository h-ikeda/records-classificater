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

- `vercel.json` でビルドコマンド・出力ディレクトリ・SPA リライトを定義。
- 環境変数 `CLERK_PUBLISHABLE_KEY` と `DATABASE_AUTHENTICATED_URL` を Vercel に設定する。

### PR ごとのプレビュー DB（Neon ブランチング）

`.github/workflows/neon-preview.yml` が PR ごとに Neon DB をブランチングする:

- PR open/更新時: `preview/pr-<番号>` ブランチを作成し、マイグレーションとシードを適用。
- PR close 時: ブランチを削除。

必要な Secrets: `NEON_API_KEY`, `NEON_PROJECT_ID`（任意の変数 `SEED_USER_ID`）。
Vercel プレビューには当該ブランチの `authenticated` 接続文字列を渡す（Neon の Vercel インテグレーション利用時は自動）。
