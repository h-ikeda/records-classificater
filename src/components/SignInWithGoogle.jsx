import { getAuth, signInWithPopup, signInWithRedirect, GoogleAuthProvider } from 'firebase/auth';
import { previewChannel } from '../firestore/channel';

// プレビューはアプリのオリジン（records-classificater--pr-<番号>-….web.app）が
// authDomain（records-classificater.web.app）と一致しない。signInWithRedirect は
// この状態だと、サードパーティ Cookie／ストレージを遮断するブラウザで成立しない
// ため、プレビューだけポップアップを使う。ポップアップは authDomain 上の
// first-party コンテキストになるので、別オリジンから呼んでも通る。
//
// 本番はアプリのオリジンと authDomain が同一なのでリダイレクトのまま。モバイルで
// ポップアップブロックに当たらない今の挙動を変えないため（README「PR プレビュー」参照）。
export default function SignInWithGoogle() {
  function signIn() {
    const auth = getAuth();
    const provider = new GoogleAuthProvider();
    if (!previewChannel) {
      signInWithRedirect(auth, provider);
      return;
    }
    signInWithPopup(auth, provider).catch((error) => {
      // ポップアップを閉じた・開き直したは操作の取り消しなので黙って無視する
      if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') return;
      console.error(error);
    });
  }

  return (
    <button onClick={signIn}>
      Sign in with Google
    </button>
  );
}
