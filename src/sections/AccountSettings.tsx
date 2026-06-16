import { useClerk, useUser } from '@clerk/clerk-react';
import { useEffect } from 'react';

export default function AccountSettings({ onClose }: { onClose: () => void }) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const displayName =
    user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || 'ユーザー';

  // Esc キーでモーダルを閉じられるようにする
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-settings-title"
    >
      <div
        className="w-full bg-white rounded-b-2xl px-5 pb-5 max-h-full overflow-y-auto shadow-2xl"
        style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}
      >
        <h3 id="account-settings-title" className="text-base font-bold text-center py-1">
          アカウント設定
        </h3>

        {/* サインイン中のユーザー情報（Google ログイン: アバターと表示名） */}
        {user && (
          <div className="flex items-center gap-3 py-3 border-b border-gray-100">
            {user.imageUrl && (
              <img
                src={user.imageUrl}
                alt=""
                className="w-12 h-12 rounded-full shrink-0 object-cover"
                onError={(e) => {
                  // 画像が読み込めないときは壊れたアイコンを出さず非表示にする
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
            <div className="min-w-0">
              <p className="font-medium text-gray-800 truncate">{displayName}</p>
              {user.primaryEmailAddress && (
                <p className="text-sm text-gray-500 truncate">
                  {user.primaryEmailAddress.emailAddress}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3 mt-2">
          <button
            type="button"
            onClick={async () => {
              try {
                await signOut();
              } catch (e) {
                console.error('Failed to sign out:', e);
                alert('ログアウトに失敗しました。時間をおいて再度お試しください。');
              }
            }}
            className="w-full border-2 border-gray-300 text-gray-700 rounded-xl py-2.5 font-medium active:bg-gray-100"
          >
            ログアウト
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full text-sm text-gray-500 py-2 active:text-gray-700"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
