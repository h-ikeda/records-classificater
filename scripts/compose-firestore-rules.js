'use strict';

// 本番用のルール（main のもの）と、プレビュー用のルール（PR ブランチのもの）を
// 1 つのルールセットに合成する。
//
//   本番     : match /databases/{database}/documents { <本番の区間> }
//   プレビュー: match /databases/{database}/documents {
//                match /preview-channels/{channel} { <ブランチの区間> } }
//
// Firestore のルールはプロジェクトに 1 つしか無いため、本番とプレビューを同じ
// ルールセットに同居させる必要がある。ここを「main のルールを土台に、ブランチの
// ルールはプレビューのパス配下へ入れ子にする」形で組むことで、
//
//   * 本番のパスを支配するのは常に main のルールになる（PR は手を出せない）
//   * PR がルールを変更しても、その効果はその PR のプレビューのパスに閉じる
//
// の 2 つが同時に成り立つ。ルール変更のある PR でも、マージ前にプレビューで
// 挙動を確かめられる。
//
// **ブランチ側の区間は信頼できない入力として扱う。** 入れ子の外へ出られない
// ことを、閉じ括弧の深さで検証する（深さが一度でも 0 を下回れば、包んでいる
// match を閉じて本番のパスに規則を足そうとしている）。ここが破れなければ、
// ブランチの区間に何が書かれていても preview-channels の外へは届かない。

const fs = require('fs');

const BEGIN = '// === APP RULES BEGIN ===';
const END = '// === APP RULES END ===';

// ルート直下を絶対パスで参照するときの唯一の書き方。プレビューではこの前に
// チャンネルのパスが挟まる。
const ROOT_PATH = '/databases/$(database)/documents';
const PREVIEW_ROOT_PATH = `${ROOT_PATH}/preview-channels/$(channel)`;

/** BEGIN / END に挟まれた区間を取り出す。 */
function extractRegion(text, label) {
  const begins = text.split(BEGIN).length - 1;
  const ends = text.split(END).length - 1;
  if (begins !== 1 || ends !== 1) {
    throw new Error(`${label}: 区間の目印が ${begins} 個 / ${ends} 個 見つかりました（それぞれ 1 個である必要があります）`);
  }
  const region = text.slice(text.indexOf(BEGIN) + BEGIN.length, text.indexOf(END));
  if (text.indexOf(END) < text.indexOf(BEGIN)) {
    throw new Error(`${label}: 区間の目印の順序が逆です`);
  }
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

/** ルート参照をプレビューのパスへ寄せる。 */
function rewriteRootPaths(region, label) {
  const rewritten = region.split(ROOT_PATH).join(PREVIEW_ROOT_PATH);
  // 置き換え後に残った /databases は、想定外の書き方をしている証拠。
  // そのまま通すと、プレビューのルールが本番のドキュメントを読んでしまう。
  const leftover = rewritten.split(PREVIEW_ROOT_PATH).join('');
  if (leftover.includes('/databases')) {
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
 * 合成したルールセットを返す。
 *
 * @param {object} options
 * @param {string} options.production 本番用ルールの中身（main のもの）
 * @param {string} [options.preview] プレビュー用ルールの中身。既定は production と同じ
 * @param {string} [options.productionLabel] 生成物のコメントに書く出所
 * @param {string} [options.previewLabel] 同上
 */
function composeRules({ production, preview, productionLabel = 'main', previewLabel = 'main' }) {
  const productionRegion = extractRegion(production, '本番のルール');
  assertSelfContained(productionRegion, '本番のルール');

  const previewSource = preview === undefined ? production : preview;
  const previewRegion = extractRegion(previewSource, 'プレビューのルール');
  assertSelfContained(previewRegion, 'プレビューのルール');
  const previewNested = rewriteRootPaths(previewRegion, 'プレビューのルール');

  return `rules_version = '2';
// この内容は scripts/compose-firestore-rules.js が生成したものです。直接編集しないでください。
// 本番のルール      : ${productionLabel}
// プレビューのルール: ${previewLabel}
service cloud.firestore {

  // ---- 本番（ルート直下）----
  match /databases/{database}/documents {
${reindent(productionRegion, 4)}
  }

  // ---- PR プレビュー（preview-channels/<チャンネル>/ 配下）----
  //
  // 本番とは別の match /databases/{database}/documents として並べてある。
  // 関数のスコープが分かれるため、この中のルールが本番側の関数を参照することは
  // なく、逆もない。パスも preview-channels 配下に限られる。
  match /databases/{database}/documents {
    match /preview-channels/{channel} {
${reindent(previewNested, 6)}
    }
  }
}
`;
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
    const composed = composeRules({
      production: fs.readFileSync(args.production, 'utf8'),
      preview: args.preview ? fs.readFileSync(args.preview, 'utf8') : undefined,
      productionLabel: args['production-label'] || args.production,
      previewLabel: args['preview-label'] || args.preview || args.production,
    });
    if (args.out) {
      fs.writeFileSync(args.out, composed);
      process.stderr.write(`合成したルールを ${args.out} に書き出しました\n`);
    } else {
      process.stdout.write(composed);
    }
  } catch (error) {
    process.stderr.write(`::error::ルールの合成に失敗しました: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { composeRules, extractRegion, assertSelfContained, BEGIN, END };
