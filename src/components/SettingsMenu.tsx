import type { User } from 'firebase/auth';
import { getAuth, signOut } from 'firebase/auth';
import { useEffect, useState } from 'react';
import DeleteAccount from './DeleteAccount';

const local = process.env.NODE_ENV !== 'production';

export default function SettingsMenu({
  currentUser,
  onOpenVehicleSettings,
}: {
  currentUser: User,
  onOpenVehicleSettings: () => void,
}) {
  const [open, setOpen] = useState(false);

  // メニューを開いている間に Esc キーで閉じられるようにする
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function handleVehicleSettings() {
    setOpen(false);
    onOpenVehicleSettings();
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="設定"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-white active:bg-lime-600"
      >
        {/* 歯車アイコン */}
        <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <>
          {/* メニュー外のタップで閉じるための透明な背面 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 z-50 min-w-44 rounded-xl border border-gray-200 bg-white py-1 text-gray-800 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={handleVehicleSettings}
              className="w-full text-left px-4 py-2.5 text-sm active:bg-gray-100"
            >
              車両設定
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => signOut(getAuth())}
              className="w-full text-left px-4 py-2.5 text-sm text-red-700 active:bg-gray-100"
            >
              ログアウト
            </button>
            {local && (
              <div className="border-t border-gray-100 mt-1 pt-1 px-4 py-1.5 text-sm text-red-700">
                <DeleteAccount currentUser={currentUser} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
