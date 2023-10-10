<template>
  <h2 class="py-0.5 px-4 text-sm bg-gray-300 -mx-4 sticky top-0 font-black">Trip classificater</h2>
  <section class="my-2 border-y-4 py-1 border-gray-300">
    <h3 class="font-black text-sm text-center mb-1">Summary</h3>
    <dl class="grid grid-flow-row w-fit gap-x-2 mx-auto auto-cols-fr">
      <template v-for="(value, key) in classSummaries" :key="key">
        <dt class="row-start-1 text-xs bg-gray-300 px-2 text-center font-medium">{{ key }}</dt>
        <dd class="row-start-2 text-end border-b px-1">{{ formatNumber(value) }} km</dd>
        <dd class="text-sm text-end px-1" v-if="sum">{{ Math.round(value / sum * 1000) / 10 }} %</dd>
      </template>
    </dl>
  </section>
  <ul class="w-fit mx-auto flex flex-col-reverse">
    <li v-for="{timestamp, odo, trip, class: cls} in calculatedTrips" class="border-b-2 border-gray-500 my-4">
      <dl class="grid items-center gap-x-2">
        <dt class="after:content-[':'] text-sm">記録日時</dt>
        <dd class="col-start-2 border-b border-dotted border-black my-1">{{ formatDate(timestamp) }}</dd>
        <dt class="after:content-[':'] text-sm">総走行距離 (ODO)</dt>
        <dd class="text-lg text-end border-b border-dotted border-black">{{ formatNumber(odo) }} km</dd>
        <template v-if="trip !== undefined">
          <dt class="after:content-[':'] text-sm">走行距離 (TRIP)</dt>
          <dd class="text-lg text-end border-b border-dotted border-black">{{ formatNumber(trip) }} km</dd>
        </template>
        <dt class="after:content-[':'] text-sm">分類</dt>
        <dd class="text-sm my-1">{{ cls }}</dd>
      </dl>
    </li>
    <li class="w-fit mx-auto py-4" v-if="currentUser">
      <button v-if="!newTripEnabled" @click="newTripEnabled = true" class="border-2 rounded-full w-10 h-10 border-gray-500 text-gray-500 text-xl font-bold flex items-center justify-center">+</button>
      <NewTrip v-if="newTripEnabled" class="border-b py-4 border-gray-500" :min-odo="lastODO" @submit="createTrip" @cancel="newTripEnabled = false" />
    </li>
  </ul>
</template>

<script setup>
import { getFirestore, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { toRefs, watch, ref, computed } from 'vue';
import NewTrip from './components/NewTrip.vue';

const props = defineProps({
  currentUser: { default: null },
});
const { currentUser } = toRefs(props);

const db = getFirestore();
const trips = ref([]);
const newTripEnabled = ref(false);
const calculatedTrips = computed(() => trips.value.reduce((acc, trip) => {
  acc.push(acc.length ? { ...trip, trip: trip.odo - acc.at(-1).odo } : trip);
  return acc;
}, []));
const classSummaries = computed(() => calculatedTrips.value.reduce((acc, { class: c, trip }) => {
  if (!(c in acc)) acc[c] = 0;
  if (trip !== undefined) acc[c] += trip;
  return acc;
}, {}));
const sum = computed(() => {
  if (trips.value.length < 2) return 0;
  return trips.value.at(-1).odo - trips.value[0].odo;
});

let unsub;
watch(currentUser, (user, oldUser, invalidate) => {
  if (oldUser) unsub();
  if (user) {
    unsub = onSnapshot(doc(db, 'trips', user.uid), (snapshot) => {
      trips.value = snapshot.data().data;
    });
    invalidate(unsub);
  } else {
    trips.value = [];
  }
}, {
  immediate: true,
});

const lastODO = computed(() => {
  const last = trips.value.at(-1);
  if (!last) return 0;
  return last.odo;
});

function formatDate(timestamp) {
  const d = timestamp.toDate();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function sortByTimestamp({ timestamp: t1 }, { timestamp: t2 }) {
  return t1 - t2;
}

function createTrip(trip) {
  setDoc(doc(db, 'trips', currentUser.value.uid), {
    data: [...trips.value, trip].sort(sortByTimestamp),
  });
  newTripEnabled.value = false;
}

function formatNumber(number) {
  return number.toFixed(6).replace(/0*$/, '');
}
</script>
