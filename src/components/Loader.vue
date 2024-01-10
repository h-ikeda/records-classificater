<template>
  <aside />
</template>

<style scoped lang="scss">
aside {
  @apply flex justify-center items-center;

  &::after {
    content: '◎';
    @apply animate-ping;
  }
}
</style>
