<template>
  <label>
    ODO:
    <input v-model.number="newODO" :min="minOdo" type="number" />
  </label>
  <label>
    Datetime:
    <input type="number" min="1970" max="9999" v-model.number="newYear" />/
    <input type="number" min="1" max="12" v-model.number="newMonth" />/
    <input type="number" min="1" max="31" v-model.number="newDate" />
    <input type="number" min="0" max="23" v-model.number="newHours" />:
    <input type="number" min="0" max="59" v-model.number="newMinutes" />:
    <input type="number" min="0" max="59" v-model.number="newSeconds" />.
    <input type="number" min="0" max="999" v-model.number="newMilliseconds" />
  </label>
  <label>
    Class:
    <select v-model="newClass">
      <option>Business</option>
      <option>Private</option>
    </select>
  </label>
  <button @click="emit('submit', newTrip)">+</button>
</template>

<script setup>
import { Timestamp } from 'firebase/firestore';
import { ref, toRefs, watch, computed } from 'vue';

const props = defineProps({
  minOdo: { type: Number, default: 0 },
});
const { minOdo } = toRefs(props);

const emit = defineEmits({
  submit: null,
});

const newODO = ref(0);
watch(minOdo, (odo) => {
  if (newODO.value < odo) newODO.value = odo;
});

const now = new Date;
const newYear = ref(now.getFullYear());
const newMonth = ref(now.getMonth() + 1);
const newDate = ref(now.getDate());
const newHours = ref(now.getHours());
const newMinutes = ref(now.getMinutes());
const newSeconds = ref(now.getSeconds());
const newMilliseconds = ref(now.getMilliseconds());
const newClass = ref('Business');

const newTrip = computed(() => {
  const createDate = new Date(newYear.value, newMonth.value - 1, newDate.value, newHours.value, newMinutes.value, newSeconds.value, newMilliseconds.value);
  const timestamp = Timestamp.fromDate(createDate);
  return { timestamp, odo: newODO.value, class: newClass.value };
});
</script>
