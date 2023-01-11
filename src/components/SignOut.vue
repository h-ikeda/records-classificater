<template>
  <button @click="logout">
    Sign out
  </button>
</template>

<script setup>
import { signOut, getAuth } from 'firebase/auth';
function logout() {
  signOut(getAuth());
}
</script>
