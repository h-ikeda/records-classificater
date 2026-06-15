import { useClerk } from '@clerk/clerk-react';
import DeleteAccount from '../components/DeleteAccount';

export default function AccountSettings({ onClose }: { onClose: () => void }) {
  const { signOut } = useClerk();

  return (
    <div
      className="fixed inset-0 z-40 flex items-start bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full bg-white rounded-b-2xl px-5 pb-5 max-h-full overflow-y-auto shadow-2xl"
        style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}
      >
        <h3 className="text-base font-bold text-center py-1">アカウント設定</h3>

        <div className="space-y-3 mt-2">
          <button
            type="button"
            onClick={() => signOut()}
            className="w-full border-2 border-gray-300 text-gray-700 rounded-xl py-2.5 font-medium active:bg-gray-100"
          >
            ログアウト
          </button>

          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-500 mb-1">危険な操作</p>
            <DeleteAccount className="w-full border-2 border-red-300 text-red-700 rounded-xl py-2.5 font-medium active:bg-red-50" />
          </div>

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
