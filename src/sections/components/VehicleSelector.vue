<template>
  <div class="grow min-w-0">
    <!-- 現在の車両（タップで選択パネルを開く） -->
    <button
      type="button"
      @click="open = true"
      class="w-full flex items-center gap-3 py-1.5 px-2.5 rounded-lg border border-gray-300 bg-white active:bg-gray-50"
    >
      <img
        v-if="vehicleImage(currentVehicle?.name)"
        :src="vehicleImage(currentVehicle?.name)"
        alt=""
        class="h-10 w-16 shrink-0 object-contain"
      />
      <span v-else class="h-10 w-16 shrink-0 flex items-center justify-center text-2xl">🚗</span>
      <span class="grow min-w-0 truncate text-left text-lg font-medium text-gray-800">
        {{ currentVehicle?.name ?? '車両を選択' }}
      </span>
      <svg class="w-4 h-4 shrink-0 text-gray-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 6l4 4 4-4" />
      </svg>
    </button>

    <!-- 車両選択パネル（どれを選択中か・どれを選ぼうとしているかを画像で示す）。
         backdrop-blur 付きの sticky ヘッダー内では fixed が効かないため body へ出す -->
    <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex items-start bg-black/40"
      @click.self="open = false"
    >
      <div
        class="w-full bg-white rounded-b-2xl px-5 pb-5 max-h-full overflow-y-auto shadow-2xl"
        style="padding-top: calc(0.75rem + env(safe-area-inset-top))"
      >
        <h3 class="text-base font-bold text-center mb-3">車両を選択</h3>
        <ul class="space-y-3">
          <li v-for="{ id, name } in vehicles" :key="id">
            <button
              type="button"
              @click="choose(id)"
              :class="id === currentVehicleId
                ? 'border-lime-500 bg-lime-50'
                : 'border-gray-200 bg-white hover:border-lime-300 hover:bg-lime-50/60 active:border-lime-400 active:bg-lime-50'"
              class="w-full flex items-center gap-4 rounded-xl border-2 p-3 transition-all active:scale-[0.98]"
            >
              <img
                v-if="vehicleImage(name)"
                :src="vehicleImage(name)"
                :alt="name"
                class="h-16 w-28 shrink-0 object-contain"
              />
              <span v-else class="h-16 w-28 shrink-0 flex items-center justify-center text-4xl">🚗</span>
              <span class="grow min-w-0 truncate text-left text-lg font-bold text-gray-800">{{ name }}</span>
              <span
                v-if="id === currentVehicleId"
                class="shrink-0 text-xs font-bold text-white bg-lime-500 rounded-full px-2.5 py-1"
              >
                ✓ 選択中
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { vehicleImage } from '../../img/vehicles';

const props = defineProps<{
  vehicles: { id: string, name: string }[],
  currentVehicleId: string | null,
}>();

const emit = defineEmits<{
  select: [id: string],
}>();

const open = ref(false);

const currentVehicle = computed(() => props.vehicles.find(({ id }) => id === props.currentVehicleId));

function choose(id: string) {
  if (id !== props.currentVehicleId) emit('select', id);
  open.value = false;
}
</script>
