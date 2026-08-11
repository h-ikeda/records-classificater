# Records Classificater

車両ごとの走行記録を、業務用・私用などの区分に分類して集計する Web アプリです。
フロントエンド（React + Parcel）が Firestore を直接読み書きし、Firebase Hosting
から配信されます。バックエンドはありません。

```
src/                          # フロントエンド
  firestore/channel.ts        # 読み書き先のチャンネル（後述）
  firestore/definitions/      # Firestore のドキュメント定義とコンバータ
firestore.rules               # セキュリティルール（本番・プレビュー共通）
test/firestore-rules.spec.ts  # ルールのテスト（エミュレータ）
.github/workflows/            # tests.yml（CI）/ deploy.yml（本番 CD）
                              # preview.yml・preview-cleanup.yml（PR プレビュー）
```

## 🧑‍💻 ローカル開発

```bash
npm ci
npm start   # エミュレータ（Auth / Firestore）を起動して Parcel の dev サーバーを動かす
npm test    # Firestore セキュリティルールのテスト（要 JRE）
```

ローカル開発では Auth と Firestore のエミュレータに接続します（`src/index.tsx`）。
実際のプロジェクトのデータには触れません。ログインはテスト用のメール／パスワード
（`abc@example.com` / `abcd1234`）で、初回サインイン時にサンプルデータが入ります。

## 🗂 チャンネル（データの分離）

本番・PR プレビューとも **同じ Firebase プロジェクト `records-classificater`** を
使い、データだけを同じ Firestore の中でパスによって分けています。

| チャンネル | `PREVIEW_CHANNEL` | 保存先 |
| --- | --- | --- |
| 本番 | （未設定） | `users/…` `vehicles/…` `trips/…`（ルート直下） |
| PR プレビュー | `pr-<番号>` | `preview-channels/pr-<番号>/users/…` など |
| ローカル開発 | （未設定） | エミュレータ（ルート直下） |

`PREVIEW_CHANNEL` はビルド時に Parcel が埋め込む変数で、読み書き先を振り替える
唯一のスイッチです。`src/firestore/channel.ts` の `channelDoc` / `channelCollection`
を通してパスを組み立てているため、アプリ側のコードはチャンネルを意識しません。

`preview-channels` を接頭辞にしているのは後片付けのためでもあります。プレビューの
削除（`preview-cleanup.yml`）は `preview-channels/pr-<番号>` の再帰削除だけを行い、
本番データのあるルート直下は削除処理の射程の外にあります。ルール側でもチャンネル名を
`pr-<番号>` に限っているので、後片付けの届かないデータは `preview-channels` の下に
作れません。

**セキュリティルール**（`firestore.rules`）はプロジェクトに対して 1 つで、本番と
プレビューの両方を受け持ちます。判定条件は関数にまとめてあり、二重に書いているのは
`match` の入れ子だけです。テストは同じケースを本番パスとプレビューパスの両方へ流し、
差が出ないことを確かめています。ルールは `main` への push で Hosting と一緒に自動
デプロイされます。

## 🚀 デプロイ

### 必要なシークレット

| シークレット | 用途 |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_RECORDS_CLASSIFICATER` | デプロイ用サービスアカウントの JSON キー。本番デプロイ・プレビュー・後片付けのすべてで使う |

サービスアカウントに必要なロール:

```bash
PROJECT_ID=records-classificater
SA=<デプロイ用 SA のメールアドレス>

# firebasehosting.admin : Hosting のデプロイとプレビューチャンネル
# firebaserules.admin   : Firestore ルールのデプロイ
# datastore.user        : PR クローズ時のプレビューデータ削除
# firebaseauth.admin    : プレビュー URL の承認済みドメインへの追加・削除
for role in roles/firebasehosting.admin roles/firebaserules.admin \
  roles/datastore.user roles/firebaseauth.admin \
  roles/serviceusage.serviceUsageConsumer roles/firebase.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:$SA" --role "$role" --condition=None
done
```

### 本番（`.github/workflows/deploy.yml`）

`main` への push で、Hosting と Firestore ルールをデプロイします。ルールを手元から
配りたい場合は `npm run deploy:rules`（本番プロジェクトを明示して実行します）。

### PR プレビュー（`.github/workflows/preview.yml`）

PR を開く・push するたびに、その PR 専用のプレビューを作り、URL を PR コメントに
掲示します。

| 環境 | Hosting | ログイン | データ |
| --- | --- | --- | --- |
| `main`（本番） | 本番チャンネル（`deploy.yml`） | Google | ルート直下 |
| PR プレビュー | `pr-<番号>` チャンネル（`preview.yml`） | Google（本番と共通） | `preview-channels/pr-<番号>/…` |
| ローカル開発 | Parcel dev サーバー | テスト用メール／パスワード | エミュレータ |

流れ:

1. `PREVIEW_CHANNEL=pr-<番号>` を渡してビルドする。
2. **ビルド成果物にそのチャンネルが埋め込まれていることを確かめる。** 変数の渡し漏れは
   ビルドもデプロイも成功したまま「プレビューが本番データを読み書きする」という形で
   表に出るため、出す前に落とします。
3. プレビューチャンネル `pr-<番号>` へデプロイする（最終デプロイから 7 日で失効）。
4. プレビュー URL を Firebase Authentication の **承認済みドメイン** へ追加する。
   プレビュー URL は本番とは別のホスト名なので、これが無いと Google ログインが
   弾かれます。チャンネル URL のハッシュはチャンネル名から決まり push しても
   変わらないため、追加は PR につき一度で済みます。
5. URL が実際に開けることを確かめ、PR にコメントする。

PR クローズ時は `preview-cleanup.yml` が、チャンネル・承認済みドメイン・
`preview-channels/pr-<番号>` 配下のデータをまとめて削除します。削除は
**「もともと無い」と「消せなかった」を区別** します。既に失効・削除済みのものは
正常として続行し、権限不足などで消せなかった場合はジョブを失敗させます。前者を
正常扱いにしたことでワークフローは冪等なので、失敗した場合は原因を直して再実行
すれば残りが片付きます。

> 承認済みドメインの API は渡した配列で **全置換** されます。追加・削除のどちらの
> ステップも、現在の一覧を取得できたことを確かめてから書き、書いたあとに「消える
> はずのないドメインが消えていない」ことまで確認します。本番のドメインを巻き込んで
> 消さないためです。

> **注意**: 分離されるのは Hosting とデータです。**ログインは本番と同じ Google
> アカウント** で、Firebase Authentication のユーザーも本番と共通です。プレビューの
> データは空の状態から始まるため、車両は PR の中で作り直してください。

> Google ログインは、本番が `signInWithRedirect`、プレビューが `signInWithPopup`
> です。プレビューの URL はアプリのオリジンが `authDomain`
> （`records-classificater.web.app`）と一致せず、この状態の
> `signInWithRedirect` はサードパーティ Cookie／ストレージを遮断するブラウザで
> 成立しないためです。ポップアップは `authDomain` 上の first-party
> コンテキストになるので、別オリジンから呼んでも通ります。本番はオリジンが
> `authDomain` と同一なので、モバイルでポップアップブロックに当たらない
> リダイレクトのままにしています。
>
> プレビュー URL 自体の承認済みドメインへの登録は
> `firebase hosting:channel:deploy` が自動で行います（`preview.yml` の登録
> ステップは、それが行われたことの確認を兼ねた押さえです）。

> Firestore のセキュリティルールはプロジェクト共通です。ルールを変更する PR では、
> その変更はマージされるまでプレビューには反映されません。

> フォークからの PR ではプレビューは動きません（シークレットが渡らないため）。

## 📦 プレビュー用プロジェクトからの移行

以前は PR プレビューだけを別プロジェクト `records-classificater-test` へ出して
いました。現在はプレビューも本番と同じプロジェクトに統合されているため、次のものは
不要です。

- Firebase プロジェクト `records-classificater-test`
- シークレット `FIREBASE_SERVICE_ACCOUNT_RECORDS_CLASSIFICATER_TEST`

統合後の最初のプレビューが動くには、`preview-channels` を許可するセキュリティ
ルールが本番プロジェクトに配られている必要があります（`main` へのマージで自動的に
配られます。先に試したい場合は `npm run deploy:rules`）。
