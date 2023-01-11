<template>
  <button @click="signIn">
    Sign in with Google
  </button>
</template>

<script setup>
import { getAuth, signInWithRedirect, GoogleAuthProvider } from 'firebase/auth';
function signIn() {
  signInWithRedirect(getAuth(), new GoogleAuthProvider());
}
</script>
