<template>
  <Loader v-if="currentUser === undefined" class="fixed inset-0 bg-slate-100 text-green-300 text-5xl" />
  <main v-else>
    <nav class="px-2 bg-lime-200 sticky top-0 flex">
      <h2 class="font-medium grow">Trip classificater</h2>
      <Auth :current-user="currentUser" />
    </nav>
    <TripClassificater v-if="currentUser" :currentUser="currentUser" />
  </main>
</template>

<script setup lang="ts">
import type { User } from 'firebase/auth';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import type { Ref } from 'vue';
import { onBeforeUnmount, ref } from 'vue';
import Auth from './components/Auth.vue';
import TripClassificater from './sections/TripClassificater.vue';
import Loader from './components/Loader.vue';

const currentUser: Ref<User|null|undefined> = ref(undefined);
const auth = getAuth();

onBeforeUnmount(
  onAuthStateChanged(auth, user => {
    currentUser.value = user;
  },
));
</script>
