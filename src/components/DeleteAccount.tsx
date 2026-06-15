import { useAuth, useUser } from '@clerk/clerk-react';
import { deleteMyAccountData } from '../db/queries';

export default function DeleteAccount({ className = '' }: { className?: string }) {
  const { user } = useUser();
  const { getToken } = useAuth();
  if (!user) return null;
  return (
    <button
      className={className}
      onClick={async () => {
        if (!confirm('アカウントを削除しますか？この操作は取り消せません。')) return;
        try {
          // 先に Neon 側のデータを削除してから Clerk のアカウントを削除する。
          // （Clerk 削除後はトークンを取得できず、DB にデータが残ってしまうため）
          const token = (await getToken()) ?? '';
          await deleteMyAccountData(token);
          await user.delete();
        } catch (e) {
          console.error('Failed to delete account:', e);
          alert('アカウントの削除に失敗しました。時間をおいて再度お試しください。');
        }
      }}
    >
      アカウントを削除
    </button>
  );
}
