import type { User } from 'firebase/auth';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { useEffect, useState } from 'react';
import Auth from './components/Auth';
import SettingsMenu from './components/SettingsMenu';
import TripClassificater from './sections/TripClassificater';
import VehicleSettings from './sections/VehicleSettings';
import Loader from './components/Loader';
import { previewChannel } from './firestore/channel';
import { done } from './bootProgress';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null | undefined>(undefined);
  const [vehicleSettingsOpen, setVehicleSettingsOpen] = useState(false);
  const auth = getAuth();

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setCurrentUser(user);
  }), [auth]);

  // 認証状態が決まれば描くものが決まるので、起動オーバーレイはここで畳む
  useEffect(() => {
    if (currentUser !== undefined) done();
  }, [currentUser]);

  // ログアウト時に車両設定モーダルを閉じ、再ログイン時の意図しない再表示を防ぐ
  useEffect(() => {
    if (!currentUser) setVehicleSettingsOpen(false);
  }, [currentUser]);

  if (currentUser === undefined) {
    return <Loader className="fixed inset-0 bg-slate-100 text-green-300 text-5xl" />;
  }

  return (
    <main>
      <nav
        className="-mx-4 px-4 py-1.5 bg-lime-500 flex items-center gap-2"
        style={{ paddingTop: 'calc(0.375rem + env(safe-area-inset-top))' }}
      >
        <h2 className="font-bold grow text-white">Trip classificater</h2>
        {/* プレビューは本番と同じアカウントでログインするため、見た目だけでは
            本番と区別が付かない。どのチャンネルを見ているかを常に出しておく */}
        {previewChannel && (
          <span className="shrink-0 text-xs font-bold text-lime-900 bg-white/80 rounded-full px-2 py-0.5">
            プレビュー {previewChannel}
          </span>
        )}
        {currentUser ? (
          <SettingsMenu currentUser={currentUser} onOpenVehicleSettings={() => setVehicleSettingsOpen(true)} />
        ) : (
          <Auth currentUser={currentUser} />
        )}
      </nav>
      {currentUser && <TripClassificater currentUser={currentUser} />}
      {currentUser && vehicleSettingsOpen && (
        <VehicleSettings currentUser={currentUser} onClose={() => setVehicleSettingsOpen(false)} />
      )}
    </main>
  );
}
