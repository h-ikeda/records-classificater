<template>
  <button @click="deleteAccount">
    Delete Account
  </button>
</template>

<script setup lang="ts">
import { User, deleteUser } from 'firebase/auth';
import { toRefs } from 'vue';

const props = defineProps<{
  currentUser: User,
}>();

const { currentUser } = toRefs(props);

function deleteAccount() {
  deleteUser(currentUser.value);
}
</script>
