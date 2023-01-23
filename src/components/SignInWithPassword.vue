<template>
  <aside class="flex flex-col space-y-2">
    <label>
      Email:
      <input v-model="email" type="email" />
    </label>
    <label>
      Password:
      <input v-model="password" type="password" />
    </label>
    <button @click="signIn">LogIn</button>
    <button @click="signUp">SignUp</button>
  </aside>
</template>

<script setup>
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { ref } from 'vue';

const email = ref('');
const password = ref('');
const auth = getAuth();

function signIn() {
  signInWithEmailAndPassword(auth, email.value, password.value);
}

function signUp() {
  createUserWithEmailAndPassword(auth, email.value, password.value);
}
</script>
