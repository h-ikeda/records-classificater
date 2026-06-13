import type { User } from 'firebase/auth';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { useEffect, useState } from 'react';
import Auth from './components/Auth';
import TripClassificater from './sections/TripClassificater';
import Loader from './components/Loader';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null | undefined>(undefined);
  const auth = getAuth();

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setCurrentUser(user);
  }), [auth]);

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
        <Auth currentUser={currentUser} />
      </nav>
      {currentUser && <TripClassificater currentUser={currentUser} />}
    </main>
  );
}
