import { SignedIn, SignedOut, useUser } from '@clerk/clerk-react';
import { useState } from 'react';
import Auth from './components/Auth';
import SettingsMenu from './components/SettingsMenu';
import TripClassificater from './sections/TripClassificater';
import VehicleSettings from './sections/VehicleSettings';
import Loader from './components/Loader';

export default function App() {
  const { isLoaded, user } = useUser();
  const [vehicleSettingsOpen, setVehicleSettingsOpen] = useState(false);

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
          <SettingsMenu onOpenVehicleSettings={() => setVehicleSettingsOpen(true)} />
        </SignedIn>
        <SignedOut>
          <Auth />
        </SignedOut>
      </nav>
      <SignedIn>
        {user && <TripClassificater userId={user.id} />}
        {user && vehicleSettingsOpen && (
          <VehicleSettings userId={user.id} onClose={() => setVehicleSettingsOpen(false)} />
        )}
      </SignedIn>
    </main>
  );
}
