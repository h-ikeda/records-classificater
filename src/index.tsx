import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { createRoot } from 'react-dom/client';
import config from './firebase';
import App from './App';

initializeApp(config);

if (process.env.NODE_ENV !== 'production') {
  connectAuthEmulator(getAuth(), 'http://localhost:9099');
  connectFirestoreEmulator(getFirestore(), 'localhost', 8080);
}

const container = document.getElementById('root')!;
createRoot(container).render(<App />);
