import { useUser } from '@clerk/clerk-react';

export default function DeleteAccount({ className = '' }: { className?: string }) {
  const { user } = useUser();
  if (!user) return null;
  return (
    <button
      className={className}
      onClick={async () => {
        if (!confirm('アカウントを削除しますか？この操作は取り消せません。')) return;
        try {
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
