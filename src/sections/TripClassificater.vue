<template>
  <!-- 車両切り替え（利用頻度が高いので常に上部に固定） -->
  <section class="sticky top-0 z-20 -mx-4 px-4 py-2 bg-white/95 backdrop-blur border-b border-gray-200 flex items-center gap-3">
    <label class="flex items-center gap-2 grow min-w-0">
      <span class="text-sm font-medium text-gray-500 shrink-0">車両</span>
      <select
        @change="setCurrentVehicle"
        :value="currentVehicleId"
        class="grow min-w-0 text-lg font-medium py-2 px-3 rounded-lg border border-gray-300 bg-white focus:outline-none focus:border-lime-500"
      >
        <option v-for="{ id, name } in vehicles" :key="id" :value="id">{{ name }}</option>
      </select>
    </label>
    <button class="shrink-0 text-sm text-blue-700 py-2 px-2" @click="share">
      共有
    </button>
  </section>

  <!-- 年間集計（確認頻度は低いので折りたたみ） -->
  <details class="my-3 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
    <summary class="cursor-pointer select-none px-4 py-3 font-bold text-gray-700 flex items-center gap-2">
      <span class="text-lime-600">📊</span>
      {{ currentYear }}年の集計
    </summary>
    <div class="px-4 pb-4 space-y-3">
      <div class="flex items-center justify-center gap-4">
        <button class="w-9 h-9 rounded-full border border-gray-300 text-gray-600 active:bg-gray-200" @click="currentYear -= 1">‹</button>
        <span class="font-black text-lg tabular-nums">{{ currentYear }}</span>
        <button class="w-9 h-9 rounded-full border border-gray-300 text-gray-600 active:bg-gray-200" @click="currentYear += 1">›</button>
      </div>
      <dl v-if="Object.keys(classSummaries).length" class="space-y-2">
        <div v-for="(value, key) in classSummaries" :key="key" class="flex items-center gap-3">
          <dt :class="classStyle(key)" class="shrink-0 text-xs font-medium px-2 py-1 rounded-full">{{ key }}</dt>
          <dd class="grow text-right tabular-nums font-medium">{{ formatNumber(value) }} km</dd>
          <dd class="w-16 text-right text-sm text-gray-500 tabular-nums" v-if="sum">{{ Math.round(value / sum * 1000) / 10 }} %</dd>
        </div>
      </dl>
      <p v-else class="text-center text-sm text-gray-400 py-2">記録がありません</p>
    </div>
  </details>

  <!-- 走行記録一覧（新しい順） -->
  <ul class="space-y-3 pb-28">
    <li
      v-for="{ id, timestamp, odo, trip, class: cls } in displayTrips"
      :key="id"
      class="rounded-xl border border-gray-200 bg-white shadow-sm p-4"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm text-gray-500 tabular-nums">{{ formatDate(timestamp) }}</span>
        <span :class="classStyle(cls)" class="text-xs font-medium px-2.5 py-1 rounded-full">{{ cls }}</span>
      </div>
      <div class="mt-3 flex items-end justify-between gap-4">
        <div v-if="trip" class="flex flex-col">
          <span class="text-xs text-gray-400">走行 (TRIP)</span>
          <span class="text-2xl font-bold tabular-nums text-gray-800">{{ formatNumber(trip) }}<span class="text-sm font-normal text-gray-500 ml-1">km</span></span>
        </div>
        <div class="flex flex-col items-end ml-auto">
          <span class="text-xs text-gray-400">総距離 (ODO)</span>
          <span class="text-lg font-medium tabular-nums text-gray-600">{{ formatNumber(odo) }}<span class="text-sm font-normal text-gray-400 ml-1">km</span></span>
        </div>
      </div>
    </li>
    <li v-if="!displayTrips.length" class="text-center text-gray-400 py-10">
      まだ記録がありません。<br />右下の「＋」から追加できます。
    </li>
  </ul>

  <!-- 記録追加（主要操作なので親指で届く位置に固定） -->
  <button
    v-if="currentVehicleId && !newTripEnabled"
    @click="newTripEnabled = true"
    aria-label="走行記録を追加"
    class="fixed right-6 z-30 w-16 h-16 rounded-full bg-lime-500 text-white text-4xl font-light shadow-lg flex items-center justify-center active:bg-lime-600"
    style="bottom: calc(1.5rem + env(safe-area-inset-bottom))"
  >
    ＋
  </button>

  <!-- 入力フォーム（ボトムシート） -->
  <div
    v-if="newTripEnabled"
    class="fixed inset-0 z-40 flex items-end bg-black/40"
    @click.self="newTripEnabled = false"
  >
    <div class="w-full bg-white rounded-t-2xl p-5 max-h-[92vh] overflow-y-auto shadow-2xl" style="padding-bottom: calc(1.25rem + env(safe-area-inset-bottom))">
      <NewTrip :min-odo="lastODO" @submit="createTrip" @cancel="newTripEnabled = false" :classOptions="vehicleClasses" />
    </div>
  </div>
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

const currentYear = ref((new Date()).getFullYear());

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

function setCurrentVehicle(event) {
  updateDoc(doc(db, 'users', currentUser.value.uid), {
    'state.vehicle': event.target.value,
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
const calculatedTrips: Ref<TripCalculated[]> = computed(() => {
  const [first, ...remains] = trips.value.sort(sortByTimestamp);
  if (!first) return [];
  return remains.reduce(([acc, odo]: [TripCalculated[], number], trip: TripIdentified): [TripCalculated[], number] => {
    acc.push({ ...trip, trip: trip.odo - odo });
    return [acc, trip.odo];
  }, [[{ ...first, trip: 0 }], first.odo])[0];
});
const classSummaries = computed(() => calculatedTrips.value.filter(({ timestamp }) => {
  return timestamp.toDate().getFullYear() === currentYear.value;
}).reduce((acc, { class: c, trip }) => {
  if (!(c in acc)) acc[c] = 0;
  if (trip !== undefined) acc[c] += trip;
  return acc;
}, {}));
const sum = computed(() => {
  const last = [...calculatedTrips.value].reverse().find(({ timestamp }) => timestamp.toDate().getFullYear() === currentYear.value);
  let first = [...calculatedTrips.value].reverse().find(({ timestamp }) => timestamp.toDate().getFullYear() === currentYear.value - 1);
  if (!first) first = calculatedTrips.value.find(({ timestamp }) => timestamp.toDate().getFullYear() === currentYear.value);
  if (!first || !last) return 0;
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

// 一覧は新しい順に表示する（trip の差分計算は古い順のまま）
const displayTrips = computed(() => [...calculatedTrips.value].reverse());

const lastODO = computed(() => {
  const last = trips.value.at(-1);
  if (!last) return 0;
  return last.odo;
});

// 分類ごとに色を割り当て、業務用と私用を一目で見分けられるようにする
const classPalette = [
  'bg-blue-100 text-blue-800',
  'bg-amber-100 text-amber-800',
  'bg-emerald-100 text-emerald-800',
  'bg-rose-100 text-rose-800',
  'bg-violet-100 text-violet-800',
  'bg-cyan-100 text-cyan-800',
];
function classStyle(cls: string) {
  const i = vehicleClasses.value.indexOf(cls);
  return classPalette[(i < 0 ? 0 : i) % classPalette.length];
}

function formatDate(timestamp) {
  const d = timestamp.toDate();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function sortByTimestamp({ timestamp: t1 }, { timestamp: t2 }) {
  return t1 - t2;
}

function createTrip(trip: Trip) {
  const prevTrip = [...calculatedTrips.value].reverse().find(({ timestamp }) => trip.timestamp.seconds > timestamp.seconds || trip.timestamp.seconds === timestamp.seconds && trip.timestamp.nanoseconds > timestamp.nanoseconds);
  const nextTrip = calculatedTrips.value.find(({ timestamp }) => trip.timestamp.seconds < timestamp.seconds || trip.timestamp.seconds === timestamp.seconds && trip.timestamp.nanoseconds < timestamp.nanoseconds);
  if (prevTrip && trip.odo <= prevTrip.odo) return;
  if (nextTrip && trip.odo >= nextTrip.odo) return;
  if (!currentVehicleId.value) return;
  addDoc(collection(db, 'vehicles', currentVehicleId.value, 'trips').withConverter(tripConverter), trip);
  newTripEnabled.value = false;
}

function formatNumber(number) {
  return number.toFixed(6).replace(/\.?0*$/, '');
}
</script>
