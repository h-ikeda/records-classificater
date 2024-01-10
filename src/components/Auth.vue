<template>
  <nav class="flex gap-2 text-red-700">
    <DeleteAccount v-if="local && currentUser" :current-user="currentUser"/>
    <SignOut v-if="currentUser" />
    <SignInWithTestEmailPassword v-else-if="dev" />
    <SignInWithGoogle v-else />
  </nav>
</template>

<script setup>
import { toRefs } from 'vue';
import SignInWithGoogle from './SignInWithGoogle.vue';
import SignInWithTestEmailPassword from './SignInWithTestEmailPassword.vue';
import SignOut from './SignOut.vue';
import DeleteAccount from './DeleteAccount.vue';

const dev = process.env.PROJECT_ID !== 'records-classificater';
const local = process.env.NODE_ENV !== 'production';

const props = defineProps({
  currentUser: { default: null },
});

const { currentUser } = toRefs(props);
</script>
