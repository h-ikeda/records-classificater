import { FirestoreDataConverter } from "firebase/firestore";

export interface Vehicle {
  classes: string[],
  name: string,
  // 車種識別子。src/models/registry.ts のキーと対応する（任意）。
  model?: string,
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
    const { classes, name, model, permissions: { read, write } } = snapshot.data(options);
    return {
      classes,
      name,
      ...(model !== undefined ? { model } : {}),
      permissions: { read, write },
    };
  },
};
