import { useUser } from '@clerk/clerk-react';

export default function DeleteAccount() {
  const { user } = useUser();
  if (!user) return null;
  return (
    <button
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
