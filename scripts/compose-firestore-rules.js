'use strict';

// 本番用のルール（main のもの）と、プレビュー用のルール（開いている PR ごとの
// もの）を 1 つのルールセットに合成する。
//
//   match /databases/{database}/documents { <main の区間> }
//   match /databases/{database}/documents {
//     match /preview-channels/pr-453 { <PR #453 の区間> } }
//   match /databases/{database}/documents {
//     match /preview-channels/pr-460 { <PR #460 の区間> } }
//
// Firestore のルールはプロジェクトに 1 つしか無いため、本番とプレビューを同じ
// ルールセットに同居させる必要がある。ここを「main のルールを土台に、各 PR の
// ルールはその PR のチャンネルのパス配下へ入れ子にする」形で組むことで、
//
//   * 本番のパスを支配するのは常に main のルールになる（PR は手を出せない）
//   * PR がルールを変更しても、その効果はその PR のチャンネルに閉じる
//   * 複数の PR が同時に開いていても、互いのルールが混ざらない
//
// が成り立つ。ルール変更のある PR でも、マージ前にプレビューで挙動を確かめられる。
//
// チャンネルのパスは変数（{channel}）ではなく **pr-<番号> の literal** で書く。
// そのため、ここに並べていないチャンネル（＝開いている PR に対応しないもの）は
// どのルールにも当たらず、既定どおり拒否される。後片付けの届かないデータを
// preview-channels の下に作れないのはこのため。
//
// **ブランチ側の区間は信頼できない入力として扱う。** 入れ子の外へ出られない
// ことを、閉じ括弧の深さで検証する（深さが一度でも 0 を下回れば、包んでいる
// match を閉じて本番のパスに規則を足そうとしている）。ここが破れなければ、
// ブランチの区間に何が書かれていても preview-channels/<そのチャンネル> の外へは
// 届かない。

const fs = require('fs');
const path = require('path');

const BEGIN = '// === APP RULES BEGIN ===';
const END = '// === APP RULES END ===';

// ルート直下を絶対パスで参照するときの唯一の書き方。プレビューではこの後ろに
// チャンネルのパスが挟まる。
const ROOT_PATH = '/databases/$(database)/documents';

// チャンネル名は PR 番号から決まる形だけを許す。
const CHANNEL_PATTERN = /^pr-\d+$/;

// Firestore にはルールセットのサイズ上限がある。上限に当たると deploy が
// 分かりにくい形で失敗するので、その手前で理由を添えて落とす。開いている PR が
// 増えるほど大きくなるため、ここが効くのは PR を溜めすぎたときになる。
const DEFAULT_MAX_BYTES = 60 * 1024;

/** BEGIN / END に挟まれた区間を取り出す。 */
function extractRegion(text, label) {
  const begins = text.split(BEGIN).length - 1;
  const ends = text.split(END).length - 1;
  if (begins !== 1 || ends !== 1) {
    throw new Error(`${label}: 区間の目印が ${begins} 個 / ${ends} 個 見つかりました（それぞれ 1 個である必要があります）`);
  }
  if (text.indexOf(END) < text.indexOf(BEGIN)) {
    throw new Error(`${label}: 区間の目印の順序が逆です`);
  }
  const region = text.slice(text.indexOf(BEGIN) + BEGIN.length, text.indexOf(END));
  if (!region.trim()) {
    throw new Error(`${label}: 区間が空です`);
  }
  return region.replace(/^\n+/, '').replace(/\s+$/, '');
}

/**
 * 括弧の対応を数えるために、コメントと文字列リテラルを取り除く。
 * 中身は捨ててよく、括弧の位置関係だけが分かればよい。
 */
function stripCommentsAndStrings(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i += 1;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      out += '""';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * 区間が自分の中で閉じていることを確かめる。
 *
 * 深さが 0 を下回った時点で、包んでいる match を閉じにいっている。総数が合って
 * いても（例: "} } match /x { ... } match /y {"）ここで捕まる。
 */
function assertSelfContained(region, label) {
  const stripped = stripCommentsAndStrings(region);
  let depth = 0;
  for (const c of stripped) {
    if (c === '{') depth += 1;
    if (c === '}') {
      depth -= 1;
      if (depth < 0) {
        throw new Error(`${label}: 閉じ括弧が多すぎます。入れ子の外にルールを足そうとしている可能性があります`);
      }
    }
  }
  if (depth !== 0) {
    throw new Error(`${label}: 括弧が閉じていません（深さ ${depth} で終わりました）`);
  }
  for (const token of ['rules_version', 'service ', 'match /databases']) {
    if (stripped.includes(token)) {
      throw new Error(`${label}: 区間に "${token}" は書けません（外側の構造は合成スクリプトが組み立てます）`);
    }
  }
}

/** ルート参照を、そのチャンネルのパスへ寄せる。 */
function rewriteRootPaths(region, channel, label) {
  const target = `${ROOT_PATH}/preview-channels/${channel}`;
  const rewritten = region.split(ROOT_PATH).join(target);
  // 置き換え後に残った /databases は、想定外の書き方をしている証拠。
  // そのまま通すと、プレビューのルールが本番のドキュメントを読んでしまう。
  if (rewritten.split(target).join('').includes('/databases')) {
    throw new Error(`${label}: ルートの絶対参照は "${ROOT_PATH}" の形だけが使えます`);
  }
  return rewritten;
}

/** 元ファイルでの字下げを剥がしてから、合成後の深さで揃え直す。 */
function reindent(text, spaces) {
  const lines = text.split('\n');
  const widths = lines
    .filter((line) => line.trim())
    .map((line) => line.length - line.trimStart().length);
  const base = widths.length ? Math.min(...widths) : 0;
  const pad = ' '.repeat(spaces);
  return lines
    .map((line) => (line.trim() ? pad + line.slice(base) : ''))
    .join('\n');
}

/**
 * 合成したルールセットを組み立てる。
 *
 * @param {object} options
 * @param {string} options.production 本番用ルールの中身（main のもの）
 * @param {{channel: string, rules: string, label?: string}[]} [options.previews]
 *   チャンネルごとのプレビュー用ルール
 * @param {string} [options.productionLabel] 生成物のコメントに書く出所
 * @param {string} [options.requiredChannel]
 *   このチャンネルだけは、検証に落ちたら例外にする（＝今デプロイしようとしている
 *   PR。ほかの PR のルールが壊れていても、そのせいで全体のデプロイを止めない）
 * @param {number} [options.maxBytes] 合成結果のサイズ上限
 * @returns {{text: string, included: string[], skipped: {channel: string, reason: string}[]}}
 */
function composeRules({
  production,
  previews = [],
  productionLabel = 'main',
  requiredChannel,
  maxBytes = DEFAULT_MAX_BYTES,
}) {
  const productionRegion = extractRegion(production, '本番のルール');
  assertSelfContained(productionRegion, '本番のルール');

  const blocks = [];
  const included = [];
  const skipped = [];

  for (const { channel, rules, label } of previews) {
    const name = label ? `${channel}（${label}）` : channel;
    try {
      if (!CHANNEL_PATTERN.test(channel)) {
        throw new Error(`チャンネル名は pr-<番号> の形である必要があります: ${channel}`);
      }
      const region = extractRegion(rules, `${name} のルール`);
      assertSelfContained(region, `${name} のルール`);
      const nested = rewriteRootPaths(region, channel, `${name} のルール`);
      blocks.push(`
  // ---- プレビュー ${name} ----
  match /databases/{database}/documents {
    match /preview-channels/${channel} {
${reindent(nested, 6)}
    }
  }
`);
      included.push(channel);
    } catch (error) {
      // 今デプロイしようとしている PR のルールが壊れているなら、黙って落として
      // 「なぜかプレビューが動かない」を作るより、はっきり失敗させる。
      if (channel === requiredChannel) throw error;
      skipped.push({ channel, reason: error.message });
    }
  }

  const text = `rules_version = '2';
// この内容は scripts/compose-firestore-rules.js が生成したものです。直接編集しないでください。
// 本番のルール      : ${productionLabel}
// プレビューのルール: ${included.length ? included.join(', ') : '（対象なし）'}
service cloud.firestore {

  // ---- 本番（ルート直下）----
  match /databases/{database}/documents {
${reindent(productionRegion, 4)}
  }
${blocks.join('')}}
`;

  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBytes) {
    throw new Error(
      `合成結果が大きすぎます（${bytes} バイト > ${maxBytes} バイト）。`
      + `開いている PR が ${previews.length} 件あります。Firestore のルールセットには`
      + 'サイズ上限があるため、PR を整理するか上限の設定を見直してください',
    );
  }

  return { text, included, skipped };
}

/** ディレクトリに並んだ <チャンネル>.rules を読み込む。 */
function readPreviewDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.rules'))
    .sort()
    .map((name) => ({
      channel: name.slice(0, -'.rules'.length),
      rules: fs.readFileSync(path.join(dir, name), 'utf8'),
    }));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--') || value === undefined) {
      throw new Error(`引数の指定が不正です: ${argv.slice(i).join(' ')}`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.production) {
      throw new Error('--production <本番ルールのパス> は必須です');
    }
    const { text, included, skipped } = composeRules({
      production: fs.readFileSync(args.production, 'utf8'),
      previews: args.previews ? readPreviewDir(args.previews) : [],
      productionLabel: args['production-label'] || args.production,
      requiredChannel: args['required-channel'],
    });
    for (const { channel, reason } of skipped) {
      // 壊れている PR のルールは飛ばす。1 つの PR のせいで、ほかの PR や本番の
      // デプロイまで止まると困るため。飛ばしたことは見えるようにしておく。
      process.stderr.write(`::warning::${channel} のルールを組み込めませんでした: ${reason}\n`);
    }
    if (args.out) {
      fs.writeFileSync(args.out, text);
      process.stderr.write(
        `合成したルールを ${args.out} に書き出しました`
        + `（プレビュー: ${included.length ? included.join(', ') : 'なし'}）\n`,
      );
    } else {
      process.stdout.write(text);
    }
  } catch (error) {
    process.stderr.write(`::error::ルールの合成に失敗しました: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { composeRules, readPreviewDir, extractRegion, assertSelfContained, BEGIN, END };
