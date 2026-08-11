// 本番・PR プレビュー・ローカル開発すべてが同じ Firebase プロジェクトを使う。
// プレビューは Hosting のチャンネル pr-<番号> に載り、データは Firestore の
// preview-channels/pr-<番号>/ 配下へ分離される（README「PR プレビュー」参照）。
// ローカル開発はエミュレータへ接続するため、この設定の実体には触れない。
export default {
  apiKey: "AIzaSyA67VdxczWRf5omaZzEBpL0ARAVD8rKQmk",
  authDomain: "records-classificater.web.app",
  projectId: "records-classificater",
  storageBucket: "records-classificater.appspot.com",
  messagingSenderId: "454521647958",
  appId: "1:454521647958:web:c22b7a14ce850d09051cf7",
  measurementId: "G-78752ECQRN"
};
