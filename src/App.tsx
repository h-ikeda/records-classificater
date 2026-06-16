import { SignedIn, SignedOut, useUser } from '@clerk/clerk-react';
import { useCallback, useRef, useState } from 'react';
import Auth from './components/Auth';
import SettingsMenu from './components/SettingsMenu';
import TripClassificater from './sections/TripClassificater';
import VehicleSettings from './sections/VehicleSettings';
import AccountSettings from './sections/AccountSettings';
import Loader from './components/Loader';

export default function App() {
  const { isLoaded, user } = useUser();
  const [vehicleSettingsOpen, setVehicleSettingsOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  // 車両設定での追加・更新を走行記録画面へ反映させるためのトリガー
  const [refreshKey, setRefreshKey] = useState(0);
  // 初回サインインで車両が無いとき、一度だけ車両設定を自動で開く
  const autoOpened = useRef(false);

  const handleNoVehicles = useCallback(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    setVehicleSettingsOpen(true);
  }, []);

  if (!isLoaded) {
    return <Loader className="fixed inset-0 bg-slate-100 text-green-300 text-5xl" />;
  }

  return (
    <main>
      <nav
        className="-mx-4 px-4 py-1.5 bg-lime-500 flex items-center gap-2"
        style={{ paddingTop: 'calc(0.375rem + env(safe-area-inset-top))' }}
      >
        <h2 className="font-bold grow text-white">Trip classificater</h2>
        <SignedIn>
          <SettingsMenu
            onOpenVehicleSettings={() => setVehicleSettingsOpen(true)}
            onOpenAccountSettings={() => setAccountSettingsOpen(true)}
          />
        </SignedIn>
        <SignedOut>
          <Auth />
        </SignedOut>
      </nav>
      <SignedIn>
        {user && (
          <TripClassificater
            userId={user.id}
            refreshKey={refreshKey}
            onNoVehicles={handleNoVehicles}
          />
        )}
        {user && vehicleSettingsOpen && (
          <VehicleSettings
            userId={user.id}
            onChanged={() => setRefreshKey((k) => k + 1)}
            onClose={() => setVehicleSettingsOpen(false)}
          />
        )}
        {user && accountSettingsOpen && (
          <AccountSettings onClose={() => setAccountSettingsOpen(false)} />
        )}
      </SignedIn>
    </main>
  );
}
