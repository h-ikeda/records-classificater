<template>
  <div class="grow min-w-0">
    <!-- 現在の車両（タップで選択パネルを開く） -->
    <button
      type="button"
      @click="open = true"
      class="w-full flex items-center gap-3 py-1.5 px-2.5 rounded-lg border border-gray-300 bg-white active:bg-gray-50"
    >
      <img
        v-if="imageFor(currentVehicle?.model)"
        :src="imageFor(currentVehicle?.model)"
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
      @click.self="close"
    >
      <div
        class="w-full bg-white rounded-b-2xl px-5 pb-5 max-h-full overflow-y-auto shadow-2xl"
        style="padding-top: calc(0.75rem + env(safe-area-inset-top))"
      >
        <!-- 車両一覧 -->
        <template v-if="!editingVehicle">
          <h3 class="text-base font-bold text-center mb-3">車両を選択</h3>
          <ul class="space-y-3">
            <li v-for="vehicle in vehicles" :key="vehicle.id">
              <div
                :class="vehicle.id === currentVehicleId
                  ? 'border-lime-500 bg-lime-50'
                  : 'border-gray-200 bg-white'"
                class="flex items-center gap-3 rounded-xl border-2 p-3"
              >
                <button
                  type="button"
                  @click="choose(vehicle.id)"
                  class="flex items-center gap-3 grow min-w-0 text-left active:scale-[0.98] transition-transform"
                >
                  <img
                    v-if="imageFor(vehicle.model)"
                    :src="imageFor(vehicle.model)"
                    :alt="labelFor(vehicle.model) ?? ''"
                    class="h-14 w-24 shrink-0 object-contain"
                  />
                  <span v-else class="h-14 w-24 shrink-0 flex items-center justify-center text-4xl">🚗</span>
                  <span class="grow min-w-0">
                    <span class="block truncate text-lg font-bold text-gray-800">{{ vehicle.name }}</span>
                    <span class="block truncate text-xs text-gray-400">{{ labelFor(vehicle.model) ?? '車種未設定' }}</span>
                  </span>
                  <span
                    v-if="vehicle.id === currentVehicleId"
                    class="shrink-0 text-xs font-bold text-white bg-lime-500 rounded-full px-2.5 py-1"
                  >
                    ✓ 選択中
                  </span>
                </button>
                <button
                  type="button"
                  @click="editingVehicleId = vehicle.id"
                  class="shrink-0 text-xs font-medium text-blue-700 border border-blue-200 rounded-lg px-2.5 py-2 active:bg-blue-50"
                >
                  車種
                </button>
              </div>
            </li>
          </ul>
        </template>

        <!-- 車種選択 -->
        <template v-else>
          <div class="flex items-center gap-2 mb-3">
            <button
              type="button"
              @click="editingVehicleId = null"
              class="shrink-0 text-sm text-blue-700 py-1 px-1"
            >
              ‹ 戻る
            </button>
            <h3 class="grow text-base font-bold text-center truncate">{{ editingVehicle.name }} の車種</h3>
            <span class="w-12 shrink-0"></span>
          </div>
          <p v-if="!modelOptions.length" class="text-center text-sm text-gray-400 py-6">車種を読み込み中…</p>
          <ul v-else class="space-y-3">
            <li v-for="option in modelOptions" :key="option.id">
              <button
                type="button"
                @click="chooseModel(option.id)"
                :class="option.id === editingVehicle.model
                  ? 'border-lime-500 bg-lime-50'
                  : 'border-gray-200 bg-white active:border-lime-400 active:bg-lime-50'"
                class="w-full flex items-center gap-4 rounded-xl border-2 p-3 transition-all active:scale-[0.98]"
              >
                <img :src="option.image" :alt="option.label" class="h-16 w-28 shrink-0 object-contain" />
                <span class="grow min-w-0 truncate text-left text-lg font-bold text-gray-800">{{ option.label }}</span>
                <span
                  v-if="option.id === editingVehicle.model"
                  class="shrink-0 text-xs font-bold text-white bg-lime-500 rounded-full px-2.5 py-1"
                >
                  ✓ 設定中
                </span>
              </button>
            </li>
          </ul>
        </template>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { loadVehicleModels, loadVehicleModelOptions, type VehicleModelConfig, type VehicleModelOption } from '../../models';

interface VehicleSummary {
  id: string;
  name: string;
  model?: string;
}

const props = defineProps<{
  vehicles: VehicleSummary[],
  currentVehicleId: string | null,
}>();

const emit = defineEmits<{
  select: [id: string],
  'update-model': [payload: { id: string, model: string }],
}>();

const open = ref(false);
const editingVehicleId = ref<string | null>(null);

// 車種レジストリは dynamic import で取得する。
const models = ref<Record<string, VehicleModelConfig>>({});
const modelOptions = ref<VehicleModelOption[]>([]);
onMounted(async () => {
  models.value = await loadVehicleModels();
  modelOptions.value = await loadVehicleModelOptions();
});

function imageFor(model?: string): string | undefined {
  return model ? models.value[model]?.image : undefined;
}
function labelFor(model?: string): string | undefined {
  return model ? models.value[model]?.label : undefined;
}

const currentVehicle = computed(() => props.vehicles.find(({ id }) => id === props.currentVehicleId));
const editingVehicle = computed(() => props.vehicles.find(({ id }) => id === editingVehicleId.value));

function close() {
  open.value = false;
  editingVehicleId.value = null;
}

function choose(id: string) {
  if (id !== props.currentVehicleId) emit('select', id);
  close();
}

function chooseModel(model: string) {
  if (editingVehicle.value && model !== editingVehicle.value.model) {
    emit('update-model', { id: editingVehicle.value.id, model });
  }
  editingVehicleId.value = null;
}
</script>
