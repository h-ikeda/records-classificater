# Records Classificater

走行距離（ODO）と分類を記録する PWA。Vercel 上で **Next.js (App Router) + Prisma
Postgres + Clerk** で動作します。

## アーキテクチャ

| 領域       | 採用技術                                                             |
| ---------- | ------------------------------------------------------------------- |
| ホスティング | Vercel                                                              |
| フロント   | Next.js App Router / React 19 / Tailwind CSS v4                      |
| 認証       | Clerk (`clerkMiddleware`, `<ClerkProvider>`)                        |
| DB         | Prisma Postgres（直接接続）                                          |
| リアルタイム | Server-Sent Events（`/api/events`、サーバー側ポーリングを配信）      |

ブラウザは Postgres に直接接続できないため、データアクセスは `src/app/api/**` の
API ルート経由に変更しました。権限は Clerk のユーザー ID と `VehicleMember`
結合テーブルでサーバー側で判定します（旧 Firestore セキュリティルール相当）。

## 環境変数

`.env.example` を `.env.local` にコピーして設定します。

- `DATABASE_URL` — Prisma Postgres の **直接接続** 文字列（`postgresql://...`）。
  プレビューごとのスキーマ分離は `?schema=` を使うため、Accelerate
  (`prisma+postgres://`) ではなく直接接続を使ってください。スキーマ名は実行時に
  自動付与されるためハードコードしないでください。
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — Clerk のキー。

## ローカル開発

```bash
npm install
npx prisma generate
npx prisma db push        # ローカル DB にスキーマを作成
npm run db:seed           # テスト用シードデータ（任意）
npm run dev
```

## プレビュー（PR）ごとのスキーマ分離

本番と全プレビューは **同一データベース** を共有し、PostgreSQL の **スキーマ** で
分離します（`src/lib/schema-name.mjs` が単一の真実の源）。

- 本番 (`VERCEL_ENV=production`) → `public`
- プレビュー (`VERCEL_ENV=preview`) → `preview_<ブランチ名をサニタイズ>`

ライフサイクル:

1. **作成 / 更新** — `npm run build` の一部として `scripts/prepare-db.mjs` が実行され、
   対象スキーマを `CREATE SCHEMA IF NOT EXISTS` してから `prisma db push` で同期します。
2. **削除** — PR がクローズ（プレビュー無効化）されると
   `.github/workflows/preview-schema-cleanup.yml` が `scripts/drop-schema.mjs` を呼び、
   `DROP SCHEMA ... CASCADE` でプレビュースキーマを削除します。

> クリーンアップワークフローには Secret `DATABASE_URL`（共有 DB への直接接続）が必要です。

## Firestore からのデータ移行

移行ロジックは `scripts/firestore-migration.ts`（再利用可能なコア）と
`scripts/migrate-firestore.ts`（CLI）に分かれています。

```bash
# 本番 Firestore -> Postgres（要 service account と UID マッピング）
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
UID_MAP_FILE=./uid-map.json \
DATABASE_URL="postgresql://..." \
npm run migrate:firestore
```

`UID_MAP_FILE` は Firebase UID → Clerk ユーザー ID の対応表
（`{ "<firebaseUid>": "<clerkUserId>" }`）。未指定の UID はそのまま使われます。

移行は **Firestore エミュレータ + Postgres** に対する統合テストで検証します
（`test/migrate-firestore.spec.ts`）。`npm test` がエミュレータを起動し、隔離スキーマ
`migration_test` を作成して移行を実行・検証します（JVM と Postgres が必要）。

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/records" npm test
```

## CI

- `.github/workflows/ci.yml` — ビルド（型チェック）と、Postgres サービス +
  Firestore エミュレータ上での移行テスト。
- `.github/workflows/preview-schema-cleanup.yml` — PR クローズ時のスキーマ削除。
