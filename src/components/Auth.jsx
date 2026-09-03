import SignInWithGoogle from './SignInWithGoogle';
import SignInWithTestEmailPassword from './SignInWithTestEmailPassword';
import SignOut from './SignOut';
import DeleteAccount from './DeleteAccount';

// テスト用のメール／パスワードログインとアカウント削除は、エミュレータに
// つないでいるローカル開発でだけ出す。PR プレビューは本番と同じ Firebase
// プロジェクト（＝本番と同じ利用者アカウント）を使うため、本番と同じ
// Google ログインになる（README「PR プレビュー」参照）。
const local = process.env.NODE_ENV !== 'production';

export default function Auth({ currentUser = null }) {
  return (
    <div className="flex gap-2 text-red-700">
      {local && currentUser && <DeleteAccount currentUser={currentUser} />}
      {currentUser ? (
        <SignOut />
      ) : local ? (
        <SignInWithTestEmailPassword />
      ) : (
        <SignInWithGoogle />
      )}
    </div>
  );
}
