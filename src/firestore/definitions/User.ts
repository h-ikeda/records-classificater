import type { FirestoreDataConverter } from "firebase/firestore";

export interface User {
  state: {
    vehicle: string,
  },
};

export const userConverter: FirestoreDataConverter<User> = {
  toFirestore(user: User) {
    return user;
  },
  fromFirestore(snapshot, options): User {
    const { state: { vehicle } } = snapshot.data(options);
    return { state: { vehicle } };
  },
};
