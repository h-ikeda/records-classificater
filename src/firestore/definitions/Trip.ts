import type { FirestoreDataConverter, Timestamp } from "firebase/firestore";

export interface Trip {
  odo: number,
  class: string,
  timestamp: Timestamp
}

export const tripConverter: FirestoreDataConverter<Trip> = {
  toFirestore(trip: Trip) {
    return trip;
  },
  fromFirestore(snapshot, options): Trip {
    const { odo, class: cls, timestamp } = snapshot.data(options);
    return { odo, class: cls, timestamp };
  },
};
