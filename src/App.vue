<template>
  <h1>Trip classificater</h1>
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
      <label>
        ODO:
        <input v-model.number="newODO" type="number" />
      </label>
      <label>
        Datetime:
        <input type="number" v-model.number="newYear" />/
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
      <button @click="createTrip">+</button>
    </li>
  </ul>
  <Suspense>
    <Auth :currentUser="currentUser" />
  </Suspense>
</template>

<script setup>
import { getAuth } from 'firebase/auth';
import { getFirestore, onSnapshot, doc, Timestamp, setDoc } from 'firebase/firestore';
import { ref } from 'vue';
import Auth from './components/Auth.vue';

const currentUser = ref(null);
const trips = ref([]);
const newODO = ref(0);
const now = new Date;
const newYear = ref(now.getFullYear());
const newMonth = ref(now.getMonth() + 1);
const newDate = ref(now.getDate());
const newHours = ref(now.getHours());
const newMinutes = ref(now.getMinutes());
const newSeconds = ref(now.getSeconds());
const newMilliseconds = ref(now.getMilliseconds());
const newClass = ref('Business');
let unsub;

getAuth().onAuthStateChanged(user => {
  if ((currentUser.value && currentUser.value.uid) !== (user && user.uid)) {
    if (currentUser.value) unsub();
    if (user) {
      unsub = onSnapshot(doc(getFirestore(), 'trips', user.uid), (snapshot) => {
        trips.value = snapshot.data().data;
      });
    }
    currentUser.value = user;
  }
});

function createTrip() {
  const createDate = new Date(newYear.value, newMonth.value - 1, newDate.value, newHours.value, newMinutes.value, newSeconds.value, newMilliseconds.value);
  const timestamp = Timestamp.fromDate(createDate);
  const odo = newODO.value;
  const cls = newClass.value;
  setDoc(doc(getFirestore(), 'trips', currentUser.value.uid), { data: [...trips.value, { timestamp, odo, class: cls }] });
}
</script>
