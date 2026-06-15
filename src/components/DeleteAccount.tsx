import { useUser } from '@clerk/clerk-react';

export default function DeleteAccount({ className = '' }: { className?: string }) {
  const { user } = useUser();
  if (!user) return null;
  return (
    <button
      className={className}
      onClick={() => {
        if (confirm('アカウントを削除しますか？この操作は取り消せません。')) {
          user.delete();
        }
      }}
    >
      アカウントを削除
    </button>
  );
}
