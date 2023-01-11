<template>
  <h2>Trip classificater</h2>
  <ul>
    <li v-for="trip in trips">
      <dl>
        <dt>Time</dt>
        <dd>{{ trip.timestamp.toDate().toString() }}</dd>
        <dt>ODO</dt>
        <dd>{{ trip.odo }}</dd>
        <dt>Class</dt>
        <dd>{{ trip.class }}</dd>
      </dl>
    </li>
    <li v-if="currentUser">
      <NewTrip :min-odo="lastODO" @submit="createTrip" />
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

let unsub;
watch(currentUser, (user, oldUser, invalidate) => {
  if (oldUser) unsub();
  if (user) {
    unsub = onSnapshot(doc(db, 'trips', user.uid), (snapshot) => {
      trips.value = snapshot.data().data;
    });
    invalidate(unsub);
  }
});

const lastODO = computed(() => {
  const last = trips.value.at(-1);
  if (!last) return 0;
  return last.odo;
});

function sortByTimestamp({ timestamp: t1 }, { timestamp: t2 }) {
  return t1 - t2;
}

function createTrip(trip) {
  setDoc(doc(db, 'trips', currentUser.value.uid), {
    data: [...trips.value, trip].sort(sortByTimestamp),
  });
}
</script>
