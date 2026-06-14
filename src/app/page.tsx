'use client';

import { SignedIn, SignedOut, SignInButton, useUser } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import SettingsMenu from '@/components/SettingsMenu';
import TripClassificater from '@/sections/TripClassificater';
import VehicleSettings from '@/sections/VehicleSettings';
import Loader from '@/components/Loader';

export default function Home() {
  const { isLoaded, isSignedIn } = useUser();
  const [vehicleSettingsOpen, setVehicleSettingsOpen] = useState(false);

  // ログアウト時に車両設定モーダルを閉じ、再ログイン時の意図しない再表示を防ぐ
  useEffect(() => {
    if (!isSignedIn) setVehicleSettingsOpen(false);
  }, [isSignedIn]);

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
          <SignInButton mode="modal">
            <button className="text-white font-medium">Sign in</button>
          </SignInButton>
        </SignedOut>
      </nav>
      <SignedIn>
        <TripClassificater />
        {vehicleSettingsOpen && (
          <VehicleSettings onClose={() => setVehicleSettingsOpen(false)} />
        )}
      </SignedIn>
    </main>
  );
}
