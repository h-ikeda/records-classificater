import { useAuth, useClerk } from '@clerk/clerk-react';
import { useCallback } from 'react';

/**
 * Neon Data API 呼び出し用の認証トークン（Clerk の JWT）を取得する Hook。
 *
 * サインイン直後は session が確立する前に getToken() が一時的に null を返すこと
 * がある。空トークンで Data API を呼ぶと anon ロール扱いになり、RLS で 0 件しか
 * 返らず「車両が無い」と誤判定してしまう。
 *
 * そこでポーリング（setTimeout でのリトライ）ではなく、Clerk の状態変化イベント
 * （addListener）で session の確立を待ち受け、トークンが得られた時点で resolve
 * する Promise を返す（イベントドリブン）。取得できないまま終わるのを防ぐため、
 * 保険として上限時間を超えたら reject する。
 */
export function useAuthToken(): () => Promise<string> {
  const { getToken } = useAuth();
  const clerk = useClerk();
  return useCallback(async () => {
    const current = await getToken();
    if (current) return current;
    // session 未確立。状態変化イベントを待ってからトークンを取得し直す。
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let unsubscribe = () => {};
      const finish = (run: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        run();
      };
      // session が確立しないまま固まるのを避けるための保険（リトライではない）。
      const timer = setTimeout(
        () => finish(() => reject(new Error('認証トークンを取得できませんでした'))),
        15000,
      );
      // addListener は購読時に最新状態を同期的に通知することがあるが、
      // session.getToken() が非同期のため finish は addListener 返却後に走り、
      // unsubscribe は必ず代入済みになる。
      unsubscribe = clerk.addListener(({ session }) => {
        if (!session) return;
        session.getToken().then(
          (next) => {
            if (next) finish(() => resolve(next));
          },
          (e) => finish(() => reject(e)),
        );
      });
    });
  }, [getToken, clerk]);
}
