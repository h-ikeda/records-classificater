<template>
  <button @click="signIn">
    LogIn
  </button>
</template>

<script setup>
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const auth = getAuth();

function signIn() {
  signInWithEmailAndPassword(auth, 'abc@example.com', 'abcd1234');
}
</script>
