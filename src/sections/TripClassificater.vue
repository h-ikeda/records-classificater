<template>
  <section class="flex gap-4 items-end">
    <select @change="setCurrentVehicle" class="mt-2 ml-1">
      <option v-for="{ id, name } in vehicles" :value="id">{{ name }}</option>
    </select>
    <button class="text-sm text-blue-700 underline" @click="share">
      共有する
    </button>
  </section>
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
    <li class="w-fit mx-auto py-4" v-if="currentVehicleId">
      <button v-if="!newTripEnabled" @click="newTripEnabled = true" class="border-2 rounded-full w-10 h-10 border-gray-500 text-gray-500 text-xl font-bold flex items-center justify-center">+</button>
      <NewTrip v-if="newTripEnabled" class="border-b py-4 border-gray-500" :min-odo="lastODO" @submit="createTrip" @cancel="newTripEnabled = false" :classOptions="vehicleClasses" />
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { User } from 'firebase/auth';
import { getFirestore, onSnapshot, doc, addDoc, setDoc, query, collection, writeBatch, getDoc, Unsubscribe, where, updateDoc, arrayUnion } from 'firebase/firestore';
import type { Ref } from 'vue';
import { toRefs, watch, ref, computed } from 'vue';
import NewTrip from './components/NewTrip.vue';
import { tripConverter, type Trip } from '../firestore/definitions/Trip';
import { userConverter } from '../firestore/definitions/User';
import { tripsConverter } from '../firestore/definitions/Trips';
import { Vehicle, vehicleConverter } from '../firestore/definitions/Vehicle';

const props = defineProps<{
  currentUser: User,
}>();

const { currentUser } = toRefs(props);
const currentVehicleId: Ref<string|null> = ref(null);
const vehicleClasses: Ref<string[]> = ref([]);

interface TripIdentified extends Trip {
  id: string,
}

interface TripCalculated extends TripIdentified {
  trip: number,
}

interface VehicleIdentified extends Vehicle {
  id: string,
}

const vehicles: Ref<VehicleIdentified[]> = ref([]);

function setCurrentVehicle(id) {
  updateDoc(doc(db, 'users', currentUser.value.uid), {
    'state.vehicle': id,
  });
}

function share() {
  if (!currentVehicleId.value) return;
  const id = prompt('共有相手のIDを入力してください');
  if (id) {
    updateDoc(doc(db, 'vehicles', currentVehicleId.value).withConverter(vehicleConverter), {
      'permissions.read': arrayUnion(id),
      'permissions.write': arrayUnion(id),
    });
  }
}

const db = getFirestore();
const trips: Ref<TripIdentified[]> = ref([]);
const newTripEnabled = ref(false);
const calculatedTrips: Ref<TripCalculated[]> = computed(() => trips.value.sort(sortByTimestamp).reduce(([acc, odo]: [TripCalculated[], number], trip: TripIdentified): [TripCalculated[], number] => {
  acc.push({ ...trip, trip: trip.odo - odo });
  return [acc, trip.odo];
}, [[], 0])[0]);
const classSummaries = computed(() => calculatedTrips.value.reduce((acc, { class: c, trip }) => {
  if (!(c in acc)) acc[c] = 0;
  if (trip !== undefined) acc[c] += trip;
  return acc;
}, {}));
const sum = computed(() => {
  const [first] = trips.value;
  const last = trips.value.at(-1);
  if (!last || first === last) return 0;
  return last.odo - first.odo;
});

let unsubUser: Unsubscribe;
let unsubVehicles: Unsubscribe;
watch(currentUser, (user, oldUser, invalidate) => {
  if (oldUser) {
    unsubUser();
    unsubVehicles();
    vehicles.value = [];
  }
  unsubUser = onSnapshot(doc(db, 'users', user.uid).withConverter(userConverter), async (snapshot) => {
    if (!snapshot.exists()) {
      const { data: oldTrips } = (await getDoc(doc(db, 'trips', user.uid).withConverter(tripsConverter))).data() || { data: [] };
      const classes = Array.from(oldTrips.reduce((acc, { class: cls }) => {
        return acc.add(cls);
      }, new Set<string>()));
      const name = prompt('車の名称を入力してください');
      const batch1 = writeBatch(db);
      const newVehicle = doc(collection(db, 'vehicles')).withConverter(vehicleConverter);
      await batch1
        .set(newVehicle, {
          classes,
          name,
          permissions: {
            read: [currentUser.value.uid],
            write: [currentUser.value.uid],
          },
        })
        .set(doc(db, 'users', user.uid).withConverter(userConverter), {
          state: { vehicle: newVehicle.id },
        })
        .commit();
      const batch2 = writeBatch(db);
      oldTrips.forEach((trip) => {
        batch2.set(doc(collection(db, 'vehicles', newVehicle.id, 'trips')).withConverter(tripConverter), trip);
      });
      batch2.commit();
      return;
    }
    currentVehicleId.value = snapshot.data().state.vehicle;
  });
  unsubVehicles = onSnapshot(query(collection(db, 'vehicles'), where('permissions.read', 'array-contains', user.uid)).withConverter(vehicleConverter), (snapshot) => {
    snapshot.docChanges().forEach(({ doc, type }) => {
      if (type === 'added') {
        vehicles.value.push({ ...doc.data(), id: doc.id });
      } else {
        const i = vehicles.value.findIndex(({ id }) => doc.id === id);
        if (type === 'modified') {
          vehicles.value.splice(i, 1, { ...doc.data(), id: doc.id });
        } else {
          vehicles.value.splice(i, 1);
        }
      }
    });
  });
  invalidate(unsubUser);
  invalidate(unsubVehicles);
}, {
  immediate: true,
});

let unsubVehicle: Unsubscribe;
let unsubTrips: Unsubscribe;
watch(currentVehicleId, (vehicleId, oldVehicleId, invalidate) => {
  if (oldVehicleId) {
    unsubVehicle();
    unsubTrips();
    trips.value = [];
  }
  if (!vehicleId) return;
  unsubVehicle = onSnapshot(doc(db, 'vehicles', vehicleId).withConverter(vehicleConverter), (snapshot) => {
    vehicleClasses.value = snapshot.data()?.classes || [];
  });
  unsubTrips = onSnapshot(collection(db, 'vehicles', vehicleId, 'trips').withConverter(tripConverter), (snapshot) => {
    snapshot.docChanges().forEach(({ type, doc }) => {
      if (type === 'added')
        trips.value.push({ ...doc.data(), id: doc.id });
      else {
        const i = trips.value.findIndex(({ id }) => id === doc.id);
        if (type === 'modified')
          trips.value.splice(i, 1, { ...doc.data(), id: doc.id });
        else
          trips.value.splice(i, 1);
      }
    });
  });
  invalidate(unsubVehicle);
  invalidate(unsubTrips);
}, {
  immediate:true,
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
  if (!currentVehicleId.value) return;
  addDoc(collection(db, 'vehicles', currentVehicleId.value, 'trips'), trip);
  newTripEnabled.value = false;
}

function formatNumber(number) {
  return number.toFixed(6).replace(/\.?0*$/, '');
}
</script>
