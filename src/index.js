import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { createApp } from 'vue';
import config from './firebase';
import App from './App.vue';

initializeApp(config);

if (process.env.NODE_ENV !== 'production') {
  connectAuthEmulator(getAuth(), 'http://localhost:9099');
  connectFirestoreEmulator(getFirestore(), 'localhost', 8080);
}

const app = createApp(App);
app.mount(document.body);
