<template>
  <TripClassificater :currentUser="currentUser" />
  <Suspense>
    <Auth :currentUser="currentUser" class="w-fit mx-auto block text-red-600 font-medium text-sm" />
  </Suspense>
</template>

<script setup>
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { ref } from 'vue';
import Auth from './components/Auth.vue';
import TripClassificater from './sections/TripClassificater.vue';

const currentUser = ref(null);
const auth = getAuth();
onAuthStateChanged(auth, user => {
  if ((user && user.uid) === (currentUser.value && currentUser.value.uid)) return;
  currentUser.value = user;
});
</script>
