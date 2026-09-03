import {
  collection,
  doc,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';

// PR プレビューは本番と同じ Firebase プロジェクトへデプロイし、データだけを
// preview-channels/pr-<番号>/ 配下へ寄せて本番と分離する（README「チャンネル」参照）。
// 本番とローカル開発は接頭辞なし（コレクションはルート直下）。
//
// 値はビルド時に Parcel が埋め込む。プレビューのワークフローが
// PREVIEW_CHANNEL=pr-<番号> を渡し、ビルド成果物にその文字列が含まれることを
// デプロイ前に確かめている。渡し忘れると「プレビューなのに本番データを読み書き
// する」という、動いてしまうぶん気付きにくい壊れ方をするため。
const channel = process.env.PREVIEW_CHANNEL || '';

// 想定外の値をそのままパスにすると、本番の隣に見慣れないコレクションができたり、
// 後片付け（preview-cleanup.yml は preview-channels/pr-<番号> だけを消す）の
// 対象から外れて残り続けたりする。起動時に落として気付けるようにする。
if (channel && !/^pr-\d+$/.test(channel)) {
  throw new Error(`PREVIEW_CHANNEL は pr-<番号> の形式で指定してください: ${channel}`);
}

/** プレビューのチャンネル名。本番・ローカル開発では null。 */
export const previewChannel: string | null = channel || null;

const prefix = channel ? ['preview-channels', channel] : [];

/** チャンネルを考慮したドキュメント参照を返す（`doc(db, ...)` の置き換え）。 */
export function channelDoc(db: Firestore, ...segments: string[]): DocumentReference<DocumentData> {
  const [first, ...rest] = [...prefix, ...segments];
  return doc(db, first, ...rest);
}

/** チャンネルを考慮したコレクション参照を返す（`collection(db, ...)` の置き換え）。 */
export function channelCollection(db: Firestore, ...segments: string[]): CollectionReference<DocumentData> {
  const [first, ...rest] = [...prefix, ...segments];
  return collection(db, first, ...rest);
}
