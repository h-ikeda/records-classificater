# Records Classificater

走行記録を業務用 / 私用などに分類して集計する Web アプリ。

インフラを **Firebase から Vercel + Neon (Postgres) + Clerk** へ移行しました。

## アーキテクチャ

| 役割 | 旧 (Firebase) | 新 |
| --- | --- | --- |
| ホスティング | Firebase Hosting | **Vercel**（静的 SPA / Parcel ビルド） |
| 認証 | Firebase Auth | **Clerk** (`@clerk/clerk-react`) |
| データベース | Firestore | **Neon (Postgres)**、ブラウザから **Neon Data API (REST)** 経由でアクセス |
| データ保護 | Firestore セキュリティルール | **Neon RLS** — Clerk の JWT を `auth.user_id()` で検証し行レベルで保護 |

ブラウザは Neon Data API(REST) を `NEXT_PUBLIC_NEON_DATA_API_URL` 経由で叩き、Clerk のトークンを
`Authorization: Bearer` で付与します。Neon が `authenticated` ロールへ切り替え、Postgres の RLS ポリシー
（`src/db/schema.ts` / `drizzle/`）が行の可否を判定します。

> スキーマ・マイグレーション・RLS は Drizzle で管理します（サーバ側）。ブラウザのデータアクセスは
> `src/db/client.ts`（REST クライアント）と `src/db/queries.ts` に集約されています。
> （Data API 構成では `authenticated` ロールが NOLOGIN のため SQL ドライバ直結は使えず、REST 経由とします）

## ディレクトリ

```text
src/db/schema.ts        Drizzle スキーマ + RLS ポリシー
src/db/client.ts        ブラウザ用 Neon Data API(REST) クライアント（Clerk JWT を Bearer 付与）
src/db/queries.ts       データアクセス層（REST 呼び出し。旧 Firestore 操作の置き換え）
src/db/seed-data.ts     プレビュー / 開発用サンプルデータ
src/migration/firestore.ts  Firestore → Neon 移行ロジック（ドライバ非依存）
drizzle/                生成済みマイグレーション（0000 ヘルパー関数 → 0001 テーブル+RLS → 0002 GRANT）
scripts/migrate-firestore.ts  本番 Firestore → Neon 移行スクリプト
scripts/seed.ts         シード投入スクリプト
test/                   移行テスト（エミュレータ→pglite）と RLS テスト（pglite）
```

## セットアップ

> [!IMPORTANT]
> **デプロイ前に Neon Authorize（Neon RLS）の有効化が必須。**
> 有効化しないと `authenticated` ロールと `auth.user_id()` が存在せず、マイグレーション
> （`GRANT ... TO authenticated` や RLS ポリシー作成）が `role "authenticated" does not exist`
> で失敗する。これらは Neon が管理するため、マイグレーションでは作成しない。

1. `.env.example` を `.env` にコピーして値を設定する。
2. Neon プロジェクトで **Neon Authorize（RLS）** を有効化し、Clerk を JWT プロバイダ（JWKS URL）として登録する。
   - Neon コンソール → 対象プロジェクト → Settings → Authorize で Clerk を追加。
   - これにより `authenticated` ロールと `auth.user_id()` がプロジェクトに用意される。
3. マイグレーションを適用: `npm run db:migrate`
4. （任意）サンプルデータ投入: `npm run db:seed`

> [!NOTE]
> Authorize を有効化する前に作成済みのプレビューブランチには、`authenticated` ロールが
> 含まれていない（ブランチ作成時点の親の状態をコピーするため）。その場合は Neon で当該
> `preview/...` ブランチを削除し、再デプロイすると Authorize 済みの親から作り直される。
> ビルド (`scripts/vercel-build.mjs`) はこの状態を検知して、分かりやすいメッセージで停止する。

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

ビルド (`scripts/vercel-build.mjs`) では、その環境の Neon ブランチへ
**マイグレーションを適用**するだけ（注入された `DATABASE_URL` を使用）。
ブラウザ側は Data API(REST) を使うため、追加の接続文字列導出は不要。

`vercel.json` がビルドコマンド (`npm run vercel-build`)・出力 (`dist`)・SPA リライトを定義する。

### 手動設定が必要なもの

- **CORS**: Neon コンソール → Data API → Advanced settings → *CORS allowed origins* に
  本番／プレビューの Vercel ドメインを登録（未設定だとブラウザからの呼び出しが拒否される）。
- **公開スキーマ**: Data API の *Exposed schemas* に `public` を含める（テーブルの所在）。
- `NEXT_PUBLIC_NEON_DATA_API_URL` は **ビルド時に `DATABASE_URL` から自動導出**される
  （プレビューごとに正しいブランチを指す）。明示設定すればそちらが優先。

前提: Neon プロジェクトで **Data API を有効化**し、Clerk を認証プロバイダ（JWKS）として登録、
**RLS を有効**にしておくこと（`authenticated` / `anonymous` ロールと `auth.user_id()` が用意される）。
プレビューブランチは親（本番）DB からのコピーなのでシードは通常不要。
ただし本番 DB にデータがない初期状態では、プレビューブランチも空になるため
`scripts/seed.ts` でサンプルデータを投入できる（ローカル開発環境でも使用可）。
