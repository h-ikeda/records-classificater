<template>
  <Loader v-if="currentUser === undefined" class="fixed inset-0 bg-slate-100 text-green-300 text-5xl" />
  <main v-else>
    <nav class="-mx-4 px-4 py-2 bg-lime-200 flex items-center gap-2" style="padding-top: calc(0.5rem + env(safe-area-inset-top))">
      <h2 class="font-bold grow text-gray-800">Trip classificater</h2>
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
