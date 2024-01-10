import { FirestoreDataConverter } from 'firebase/firestore';
import type { Trip } from './Trip';

export interface Trips {
  data: Trip[],
}

export const tripsConverter: FirestoreDataConverter<Trips> = {
  fromFirestore(snapshot, options): Trips {
    const { data } = snapshot.data(options);
    return { data };
  },
  toFirestore(trips: Trips) {
    return trips;
  },
};
