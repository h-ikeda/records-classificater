<template>
  <Loader v-if="currentUser === undefined" class="loader" />
  <main v-else>
    <nav>
      <h2 class="font-medium">Trip classificater</h2>
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

<style scoped lang="scss">
.loader {
  @apply fixed inset-0 bg-slate-100 text-green-300 text-5xl;
}

main > nav {
  @apply px-2 bg-lime-200 sticky top-0 flex;

  h2:first-child {
    @apply grow;
  }
}
</style>
