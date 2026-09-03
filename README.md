# Records Classificater

車両ごとの走行記録を、業務用・私用などの区分に分類して集計する Web アプリです。
フロントエンド（React + Parcel）が Firestore を直接読み書きし、Firebase Hosting
から配信されます。バックエンドはありません。

```
src/                          # フロントエンド
  firestore/channel.ts        # 読み書き先のチャンネル（後述）
  firestore/definitions/      # Firestore のドキュメント定義とコンバータ
firestore.rules               # セキュリティルール（**本番用のみ**。後述）
scripts/                      # compose-firestore-rules.js（本番＋プレビューの合成）
test/firestore-rules.spec.ts  # ルールのテスト（エミュレータ）
.github/workflows/            # tests.yml（CI）/ deploy.yml（本番 CD）
                              # preview-build.yml・preview-deploy.yml
                              # preview-cleanup.yml（PR プレビュー）
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
本番データのあるルート直下は削除処理の射程の外にあります。

## 🔐 セキュリティルールの合成

Firestore のルールはプロジェクトに 1 つしか持てないため、本番とプレビューは同じ
ルールセットに同居させるほかありません。とはいえ、両方を手で書くと二重管理になり、
「PR がルールを変更したら本番のルールも変わる」という事故の余地も残ります。

そこで **リポジトリに置くのは本番用のルールだけ** にし、デプロイのときに
`scripts/compose-firestore-rules.js` が合成します。

| | 出どころ | 効く範囲 |
| --- | --- | --- |
| 本番の区間 | **`main` の `firestore.rules`** | ルート直下（`users/…` `vehicles/…` `trips/…`） |
| プレビューの区間 | **その PR のブランチの `firestore.rules`** | `preview-channels/<チャンネル>/…` |

合成後はこういう形になります。関数のスコープが分かれるよう、本番とプレビューは
別々の `match /databases/{database}/documents` として並べます。

```
service cloud.firestore {
  match /databases/{database}/documents {          // 本番: main のルール
    ...
  }
  match /databases/{database}/documents {
    match /preview-channels/{channel} {            // プレビュー: ブランチのルール
      ...
    }
  }
}
```

この形にすると 2 つのことが同時に成り立ちます。

- **本番のパスを支配するのは常に `main` のルール** です。PR は本番のルールに手を
  出せません。
- **PR がルールを変更しても、効果はプレビューのパスに閉じます。** ルールを変更する
  PR でも、マージ前にプレビューで挙動を確かめられます。

`firestore.rules` の中の `// === APP RULES BEGIN ===` から `// === APP RULES END ===`
までが、合成スクリプトが取り出す区間です。区間の中からルートを絶対パスで参照する
ときは、必ず `/databases/$(database)/documents` の形で書いてください（合成時に
プレビューのパスへ置き換えます）。

> **ブランチ側の区間は信頼できない入力として扱っています。** 入れ子の外へ出られない
> ことを、閉じ括弧の深さで検証します（深さが一度でも 0 を下回れば、包んでいる
> `match` を閉じて本番のパスに規則を足そうとしている）。括弧の総数が合っていても
> 捕まります。テストでは、実際に「何でも許す」ブランチのルールで合成し、それでも
> 本番のパスには一切届かないことを確かめています。

> チャンネル名を `pr-<番号>` に限る仕組みはありません。プレビューの区間は PR 側の
> ものをそのまま入れ子にするため、そこへ条件を差し込む処理は壊れやすく、得られる
> ものが「後片付けの届かないゴミが増えない」という程度に留まるためです（サインイン
> 済みの利用者は、元からルート直下に同じだけのデータを作れます）。

合成物 `firestore.composed.rules` は生成物なので追跡していません。`npm start` /
`npm test` / `npm run deploy:rules` は自動で作り直します。手元で中身を見たいときは
`npm run rules:compose` を実行してください。

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

### PR プレビュー（`preview-build.yml` → `preview-deploy.yml`）

PR を開く・push するたびに、その PR 専用のプレビューを作り、URL を PR コメントに
掲示します。

| 環境 | Hosting | ログイン | データ | ルール |
| --- | --- | --- | --- | --- |
| `main`（本番） | 本番チャンネル（`deploy.yml`） | Google | ルート直下 | `main` |
| PR プレビュー | `pr-<番号>` チャンネル | Google（本番と共通） | `preview-channels/pr-<番号>/…` | 本番は `main`、プレビューは PR |
| ローカル開発 | Parcel dev サーバー | テスト用メール／パスワード | エミュレータ | 合成後のもの |

**ビルドとデプロイは別のワークフローに分けてあります。** PR のコードは PR の作者が
自由に書けるため（`package.json` のインストールスクリプトも、ビルド設定も）、それを
動かす場所にデプロイ用の資格情報があると、認証後にそれを外へ送る細工ができてしまい
ます。

| | トリガー | 実行されるコード | シークレット |
| --- | --- | --- | --- |
| `preview-build.yml` | `pull_request` | **PR のコード** | 渡さない |
| `preview-deploy.yml` | `workflow_run` | **`main` のコード** | 使う |

`workflow_run` のワークフローは、定義もチェックアウトされるコードも既定ブランチの
ものになるため、PR 側からは書き換えられません。デプロイ側が PR から受け取るのは
次の 2 つだけで、どちらも信頼しない入力として扱います。

- `dist/` … 配信するファイル。プレビューとはそもそもこれを見るもの
- `firestore.rules` … `main` の本番用ルールと合成し、プレビューのパス配下へ
  入れ子にする（「セキュリティルールの合成」参照）

PR 番号も、成果物に書かれた値ではなく、ビルドを起こしたコミットから API で引き
直します。成果物は PR 側で作られるため、そこに書かれた番号をそのまま信じると、
別の PR のチャンネルへ出させることができてしまうためです。

流れ:

1. （PR 側）`PREVIEW_CHANNEL=pr-<番号>` を渡してビルドする。
2. （PR 側）**ビルド成果物にそのチャンネルが埋め込まれていることを確かめる。**
   変数の渡し漏れは、ビルドもデプロイも成功したまま「プレビューが本番データを
   読み書きする」という形で表に出るため、出す前に落とします。
3. （`main` 側）PR を API で確かめ、成果物を受け取る。
4. （`main` 側）`main` の本番用ルールと PR のルールを合成してデプロイする。
5. （`main` 側）プレビューチャンネル `pr-<番号>` へデプロイする（最終デプロイから
   7 日で失効）。
6. （`main` 側）プレビュー URL を Firebase Authentication の **承認済みドメイン**
   へ追加する。プレビュー URL は本番とは別のホスト名なので、これが無いと Google
   ログインが弾かれます。URL のハッシュ部分はチャンネルが生きている間は変わらない
   ため、push を重ねても追加は一度で済みます。ただし **チャンネルが失効した後に
   再度デプロイすると、別のハッシュの URL になります**（同じ `pr-<番号>` でも作り
   直しになるため）。以前貼った URL は死に、承認済みドメインには古いホスト名が
   残ります。後片付けが `--pr-<番号>-` を含むホストを **すべて** 消すのはこのため
   です。
7. （`main` 側）URL が実際に開けることを確かめ、PR にコメントする。

PR クローズ時は `preview-cleanup.yml` が、チャンネル・承認済みドメイン・
`preview-channels/pr-<番号>` 配下のデータをまとめて削除します。こちらは
`pull_request_target`（＝ベースブランチの定義で動き、PR のコードをチェックアウト
しない）を使っており、デプロイ側と同じく PR から書き換えられません。削除は
**「もともと無い」と「消せなかった」を区別** します。既に失効・削除済みのものは
正常として続行し、権限不足などで消せなかった場合はジョブを失敗させます。前者を
正常扱いにしたことでワークフローは冪等なので、失敗した場合は原因を直して再実行
すれば残りが片付きます。

> **デプロイは PR のチェック一覧に出ません。** `workflow_run` の実行は PR に
> 紐づかないためです。ビルドの成否は Preview build のチェックで、デプロイの結果は
> PR コメントで確認してください。

> **`preview-deploy.yml` は既定ブランチに存在して初めて動きます。** この仕組みを
> 追加する PR 自身のプレビューは、マージされるまで更新されません。

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
> `firebase hosting:channel:deploy` が自動で行います（登録ステップは、それが
> 行われたことの確認を兼ねた押さえです）。

> **プレビューのルールは、最後にデプロイされた PR のものが全チャンネルに効きます。**
> ルールを変更しない PR では `main` と同じ内容になるため差は出ませんが、ルールを
> 変更する PR がデプロイされると、その内容が他の PR のプレビューにも当たります。
> 気になる場合は、その PR のプレビューを再デプロイし直してください（`main` への
> マージでも `main` の内容に戻ります）。

> フォークからの PR ではプレビューは動きません（デプロイ側が明示的に弾いています）。

## 📦 プレビュー用プロジェクトからの移行

以前は PR プレビューだけを別プロジェクト `records-classificater-test` へ出して
いました。現在はプレビューも本番と同じプロジェクトに統合されているため、次のものは
不要です。

- Firebase プロジェクト `records-classificater-test`
- シークレット `FIREBASE_SERVICE_ACCOUNT_RECORDS_CLASSIFICATER_TEST`

統合後の最初のプレビューが動くには、`preview-channels` を許可するセキュリティ
ルールが本番プロジェクトに配られている必要があります（`main` へのマージで自動的に
配られます。先に試したい場合は `npm run deploy:rules`）。
