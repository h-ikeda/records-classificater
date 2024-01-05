<template>
  <nav class="grid grid-col gap-2">
    <SignOut v-if="currentUser" />
    <SignInWithTestEmailPassword v-else-if="dev" />
    <SignInWithGoogle v-else />
    <DeleteAccount v-if="local && currentUser" :current-user="currentUser"/>
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
