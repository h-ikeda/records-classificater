import { FirestoreDataConverter } from "firebase/firestore";

export interface Vehicle {
  classes: string[],
  name: string,
  permissions: {
    read: string[],
    write: string[],
  },
}

export const vehicleConverter: FirestoreDataConverter<Vehicle> = {
  toFirestore(vehicle: Vehicle) {
    return vehicle;
  },
  fromFirestore(snapshot, options): Vehicle {
    const { classes, name, permissions: { read, write } } = snapshot.data(options);
    return { classes, name, permissions: { read, write } };
  },
};
