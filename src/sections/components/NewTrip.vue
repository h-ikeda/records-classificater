<template>
  <form class="space-y-5" @submit.prevent="onSubmit">
    <h3 class="text-lg font-bold text-center">走行記録を追加</h3>

    <!-- ODO -->
    <label class="block space-y-1">
      <span class="text-sm font-medium text-gray-600">総走行距離 (ODO)</span>
      <div class="flex items-baseline gap-2">
        <input
          v-model.number="newODO"
          ref="odoInput"
          type="number"
          inputmode="decimal"
          step="any"
          :min="minOdo"
          class="w-full text-3xl font-bold tabular-nums border-b-2 border-lime-500 bg-transparent py-1 focus:outline-none"
        />
        <span class="text-lg text-gray-500">km</span>
      </div>
      <p v-if="minOdo > 0" class="text-xs text-gray-400">前回の記録: {{ minOdo }} km 以上</p>
    </label>

    <!-- 分類 -->
    <div class="space-y-1">
      <span class="text-sm font-medium text-gray-600">分類</span>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="classOption in classOptions"
          :key="classOption"
          type="button"
          @click="newClass = classOption"
          :class="newClass === classOption
            ? 'bg-lime-500 text-white border-lime-500'
            : 'bg-white text-gray-700 border-gray-300'"
          class="px-4 py-2 rounded-full text-base font-medium border-2 transition-colors active:scale-95"
        >
          {{ classOption }}
        </button>
      </div>
    </div>

    <!-- 記録日時 -->
    <div class="space-y-2">
      <label class="flex items-center justify-between">
        <span class="text-sm font-medium text-gray-600">日時を調整する</span>
        <input type="checkbox" v-model="adjustDateTime" class="w-5 h-5 accent-lime-500" />
      </label>
      <p v-if="!adjustDateTime" class="text-sm text-gray-500">
        現在時刻で記録します（{{ formatPreview(new Date()) }}）
      </p>
      <input
        v-else
        v-model="dateTimeLocal"
        type="datetime-local"
        step="1"
        class="w-full text-lg border rounded-lg px-3 py-2 border-gray-300 focus:outline-none focus:border-lime-500"
      />
    </div>

    <!-- 操作 -->
    <div class="flex gap-3 pt-2">
      <button
        type="button"
        @click="emit('cancel')"
        class="flex-1 border-2 border-gray-300 text-gray-600 rounded-xl py-3 font-medium active:bg-gray-100"
      >
        キャンセル
      </button>
      <button
        type="submit"
        class="flex-1 bg-lime-500 text-white rounded-xl py-3 font-bold shadow active:bg-lime-600"
      >
        記録する
      </button>
    </div>
  </form>
</template>

<script setup>
import { Timestamp } from 'firebase/firestore';
import { ref, toRefs, watch, onMounted } from 'vue';

const props = defineProps({
  minOdo: { type: Number, default: 0 },
  classOptions: { type: Array },
});
const { minOdo, classOptions } = toRefs(props);
const odoInput = ref(null);

const emit = defineEmits({
  submit: null,
  cancel: null,
});

const newODO = ref(0);
watch(minOdo, (odo) => {
  if (newODO.value < odo) newODO.value = odo;
}, {
  immediate: true,
});

const newClass = ref(classOptions.value[0]);

// 日時は通常「現在時刻」で記録し、必要なときだけ調整する。
const adjustDateTime = ref(false);
const dateTimeLocal = ref(toLocalInputValue(new Date()));
watch(adjustDateTime, (on) => {
  // 調整を開始したら現在時刻を初期値にする
  if (on) dateTimeLocal.value = toLocalInputValue(new Date());
});

function toLocalInputValue(d) {
  const p = (n, len = 2) => String(n).padStart(len, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatPreview(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function onSubmit() {
  const date = adjustDateTime.value ? new Date(dateTimeLocal.value) : new Date();
  if (isNaN(date.getTime())) return;
  if (typeof newODO.value !== 'number' || isNaN(newODO.value) || newODO.value < minOdo.value) return;
  emit('submit', {
    timestamp: Timestamp.fromDate(date),
    odo: newODO.value,
    class: newClass.value,
  });
}

onMounted(() => odoInput.value.focus());
</script>
