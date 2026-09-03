'use strict';

// 開いている PR ごとに firestore.rules を集めて、<チャンネル>.rules として並べる。
// compose-firestore-rules.js の --previews に渡すためのもの。
//
// デプロイのたびに「今開いている PR」から作り直すため、状態を持たずに済む。
// PR が閉じればその PR のブロックは次のデプロイで消え、新しい PR は最初の
// デプロイで入る。どのデプロイから走っても同じ結果になる。
//
// 取りに行くのは各 PR の **head の firestore.rules** だけで、PR のコードは
// 一切実行しない。取れた中身は信頼できない入力として、合成側が検証する。
//
// フォークからの PR は対象外。プレビュー自体を出していないため。

const fs = require('fs');
const path = require('path');

const API = process.env.GITHUB_API_URL || 'https://api.github.com';

async function api(url, { raw = false } = {}) {
  const response = await fetch(url, {
    headers: {
      accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'collect-preview-rules',
    },
  });
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText}: ${url}`);
    error.status = response.status;
    throw error;
  }
  return raw ? response.text() : response.json();
}

/** 開いている PR を全部（ページをまたいで）返す。 */
async function listOpenPullRequests(repo) {
  const pulls = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await api(`${API}/repos/${repo}/pulls?state=open&per_page=100&page=${page}`);
    pulls.push(...batch);
    if (batch.length < 100) break;
  }
  return pulls;
}

async function main() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) args[argv[i].slice(2)] = argv[i + 1];

  const repo = args.repo || process.env.GITHUB_REPOSITORY;
  const out = args.out || 'previews';
  if (!repo) throw new Error('--repo <owner/name> は必須です');
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN が未設定です');

  fs.mkdirSync(out, { recursive: true });

  const pulls = await listOpenPullRequests(repo);
  const collected = [];
  for (const pull of pulls) {
    if (pull.head.repo?.full_name !== repo) {
      // フォークからの PR にはプレビューを出していないので、ルールも要らない。
      continue;
    }
    const channel = `pr-${pull.number}`;
    try {
      const rules = await api(
        `${API}/repos/${repo}/contents/firestore.rules?ref=${pull.head.sha}`,
        { raw: true },
      );
      fs.writeFileSync(path.join(out, `${channel}.rules`), rules);
      collected.push(`${channel} (${pull.head.sha.slice(0, 7)})`);
    } catch (error) {
      // その PR で firestore.rules が消えている・読めないだけなら、その PR を
      // 飛ばして続ける。1 つの PR のせいで全体のデプロイを止めない。
      process.stderr.write(
        `::warning::${channel} の firestore.rules を取得できませんでした: ${error.message}\n`,
      );
    }
  }
  process.stdout.write(
    `プレビューのルールを集めました: ${collected.length ? collected.join(', ') : '（対象なし）'}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`::error::プレビューのルール収集に失敗しました: ${error.message}\n`);
  process.exit(1);
});
