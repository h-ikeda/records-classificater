<template>
  <button @click="signIn">
    LogIn
  </button>
</template>

<script setup>
import { createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc, Timestamp } from 'firebase/firestore';

const auth = getAuth();

function signIn() {
  signInWithEmailAndPassword(auth, 'abc@example.com', 'abcd1234').catch(async ({ code }) => {
    if (code !== 'auth/user-not-found') return;
    const { user } = await createUserWithEmailAndPassword(auth, 'abc@example.com', 'abcd1234');
    const now = Date.now();
    setDoc(doc(getFirestore(), 'trips', user.uid), {
      data: [{
        class: 'Private',
        odo: 140,
        timestamp: Timestamp.fromMillis(now - 5.92 * 24 * 3600 * 1000),
      }, {
        class: 'Business',
        odo: 199,
        timestamp: Timestamp.fromMillis(now - 5.03 * 24 * 3600 * 1000),
      }, {
        class: 'Business',
        odo: 323,
        timestamp: Timestamp.fromMillis(now - 4.05 * 24 * 3600 * 1000),
      }, {
        class: 'Private',
        odo: 342,
        timestamp: Timestamp.fromMillis(now - 2.8 * 24 * 3600 * 1000),
      }, {
        class: 'Private',
        odo: 369,
        timestamp: Timestamp.fromMillis(now - 2.1 * 24 * 3600 * 1000),
      }, {
        class: 'Business',
        odo: 369.9,
        timestamp: Timestamp.fromMillis(now - 0.9 * 24 * 3600 * 1000),
      }, {
        class: 'Private',
        odo: 370,
        timestamp: Timestamp.fromMillis(now),
      }],
    });
  });
}
</script>
