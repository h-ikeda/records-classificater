<template>
  <SignOut v-if="currentUser" />
  <SignInWithPassword v-else-if="dev" />
  <SignInWithGoogle v-else />
</template>

<script setup>
import { User } from 'firebase/auth';
import { toRefs } from 'vue';
import SignInWithGoogle from './SignInWithGoogle.vue';
import SignInWithPassword from './SignInWithPassword.vue';
import SignOut from './SignOut.vue';

const dev = process.env.NODE_ENV !== 'production';

const props = defineProps({
  currentUser: { type: User, default: null },
});

const { currentUser } = toRefs(props);
</script>
