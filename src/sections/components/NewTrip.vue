<template>
  <aside class="space-y-3">
    <label class="flex items-center space-x-2">
      <span class="after:content-[':']">ODO</span>
      <input v-model.number="newODO" :min="minOdo" type="number" ref="odoInput" class="text-xl" />
    </label>
    <label class="flex items-center space-x-2">
      <span class="after:content-[':']">分類</span>
      <select v-model="newClass" class="text-xl">
        <option v-for="classOption in classOptions">{{ classOption }}</option>
      </select>
    </label>
    <label class="grid items-center space-x-2">
      <span class="after:content-[':']">記録日時</span>
      <input class="col-start-2" type="number" min="1970" max="9999" v-model.number="newYear" />/
      <input class="col-start-4" type="number" min="1" max="12" v-model.number="newMonth" />/
      <input class="col-start-6" type="number" min="1" max="31" v-model.number="newDate" />
      <input class="col-start-2" type="number" min="0" max="23" v-model.number="newHours" />:
      <input class="col-start-4" type="number" min="0" max="59" v-model.number="newMinutes" />:
      <input class="col-start-6" type="number" min="0" max="59" v-model.number="newSeconds" />.
      <input class="col-start-8" type="number" min="0" max="999" v-model.number="newMilliseconds" />
    </label>
    <div class="flex justify-center space-x-4 py-3">
      <button @click="emit('cancel')" class="border-2 border-black rounded-lg px-4 py-1 font-medium">Cancel</button>
      <button @click="emit('submit', newTrip)" class="border-2 border-black rounded-lg px-4 py-1 font-medium">Submit</button>
    </div>
  </aside>
</template>

<script setup>
import { Timestamp } from 'firebase/firestore';
import { ref, toRefs, watch, computed, onMounted, nextTick } from 'vue';

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

const now = new Date;
const newYear = ref(now.getFullYear());
const newMonth = ref(now.getMonth() + 1);
const newDate = ref(now.getDate());
const newHours = ref(now.getHours());
const newMinutes = ref(now.getMinutes());
const newSeconds = ref(now.getSeconds());
const newMilliseconds = ref(now.getMilliseconds());
const newClass = ref(classOptions.value[0]);

const newTrip = computed(() => {
  const createDate = new Date(newYear.value, newMonth.value - 1, newDate.value, newHours.value, newMinutes.value, newSeconds.value, newMilliseconds.value);
  const timestamp = Timestamp.fromDate(createDate);
  return { timestamp, odo: newODO.value, class: newClass.value };
});

onMounted(() => odoInput.value.focus());
</script>
